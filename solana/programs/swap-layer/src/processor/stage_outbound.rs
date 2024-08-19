use crate::{
    composite::*,
    error::SwapLayerError,
    state::{Peer, RedeemOption, StagedOutbound, StagedOutboundInfo, StagedRedeem},
    utils, TRANSFER_AUTHORITY_SEED_PREFIX,
};
use anchor_lang::{prelude::*, system_program};
use anchor_spl::{token, token_interface};
use common::wormhole_io::{Readable, Writeable};
use solana_program::keccak;
use swap_layer_messages::types::OutputToken;

#[derive(Accounts)]
#[instruction(args: StageOutboundArgs)]
pub struct StageOutbound<'info> {
    #[account(mut)]
    payer: Signer<'info>,

    /// This signer is mutable in case the integrator wants to separate the payer of accounts from
    /// the sender, who may be sending lamports ([StageOutboundArgs::is_native] is true).
    #[account(mut)]
    sender: Option<Signer<'info>>,

    #[account(
        seeds = [
            TRANSFER_AUTHORITY_SEED_PREFIX,
            &keccak::hash(&args.try_to_vec()?).0,
        ],
        bump,
        constraint = sender_token.is_some() @ SwapLayerError::SenderTokenRequired,
    )]
    program_transfer_authority: Option<UncheckedAccount<'info>>,

    /// If provided, this token account's mint must be equal to the source mint.
    ///
    /// NOTE: This account may not be necessary because the sender may send lamports directly
    /// ([StageOutboundArgs::is_native] is true).
    #[account(
        mut,
        token::mint = src_mint,
        token::token_program = src_token_program,
    )]
    sender_token: Option<InterfaceAccount<'info, token_interface::TokenAccount>>,

    /// Peer used to determine whether assets are sent to a valid destination. The registered peer
    /// will also act as the authority over the staged custody token account.
    ///
    /// Ordinarily we could consider the authority to be the staged outbound account itself. But
    /// because this account can be signed for outside of this program (either keypair or PDA), the
    /// token account would then be out of this program's control.
    #[account(
        constraint = {
            require_eq!(
                args.target_chain,
                target_peer.seeds.chain,
                SwapLayerError::InvalidTargetChain,
            );

            true
        }
    )]
    target_peer: RegisteredPeer<'info>,

    /// Staged outbound account, which contains all of the instructions needed to initiate a
    /// transfer on behalf of the sender.
    #[account(
        init,
        payer = payer,
        space = StagedOutbound::try_compute_size(&args.redeem_option, &args.encoded_output_token)?,
        constraint = {
            // Disallow amount in of zero.
            require!(args.amount_in != 0, SwapLayerError::ZeroAmountIn);

            // Cannot send to zero address.
            require!(args.recipient != [0; 32], SwapLayerError::InvalidRecipient);

            // Min amount out must be specified for swaps into USDC.
            require!(
                args.min_amount_out.is_some() || src_mint.key() == common::USDC_MINT,
                SwapLayerError::MinAmountOutRequired,
            );

            true
        }
    )]
    staged_outbound: Account<'info, StagedOutbound>,

    /// Custody token account for the staged outbound transfer. This account will be owned by the
    /// registered peer.
    #[account(
        init,
        payer = payer,
        token::mint = src_mint,
        token::authority = target_peer,
        token::token_program = src_token_program,
        seeds = [
            crate::STAGED_CUSTODY_TOKEN_SEED_PREFIX,
            staged_outbound.key().as_ref(),
        ],
        bump,
    )]
    staged_custody_token: Box<InterfaceAccount<'info, token_interface::TokenAccount>>,

    #[account(
        mut,
        token::mint = common::USDC_MINT
    )]
    usdc_refund_token: Box<Account<'info, token::TokenAccount>>,

    /// Mint can either be USDC or whichever mint is used to swap into USDC.
    #[account(
        token::token_program = src_token_program,
        constraint = {
            if sender_token.is_none() {
                require_keys_eq!(
                    src_mint.key(),
                    token::spl_token::native_mint::ID,
                    SwapLayerError::InvalidSourceMint,
                );
            }

            true
        }
    )]
    src_mint: Box<InterfaceAccount<'info, token_interface::Mint>>,

    src_token_program: Interface<'info, token_interface::TokenInterface>,
    token_program: Program<'info, token::Token>,
    system_program: Program<'info, System>,
}

/// Arguments for [stage_outbound].
#[derive(Debug, Clone, AnchorSerialize, AnchorDeserialize)]
pub struct StageOutboundArgs {
    pub amount_in: u64,

    // Must be specified for swaps into USDC.
    pub min_amount_out: Option<u64>,

    /// This argument only applies to relays. If exact in is specified, the relaying fee will be
    /// removed from the amount in. Otherwise it will be added to the amount in to guarantee the
    /// USDC amount specified above.
    ///
    /// For swaps, this argument will determine whether which initiate swap instruction to use.
    pub is_exact_in: bool,

    /// The Wormhole chain ID of the network to transfer tokens to.
    pub target_chain: u16,

    /// The recipient of the transfer.
    pub recipient: [u8; 32],

    pub redeem_option: Option<RedeemOption>,

    pub encoded_output_token: Option<Vec<u8>>,
}

pub fn stage_outbound(ctx: Context<StageOutbound>, args: StageOutboundArgs) -> Result<()> {
    // In case we use a program transfer authority, we need to use these for the transfer.
    let last_transfer_authority_signer_seeds = ctx
        .bumps
        .program_transfer_authority
        .map(|bump| (keccak::hash(&args.try_to_vec().unwrap()).0, bump));

    let StageOutboundArgs {
        amount_in,
        min_amount_out,
        is_exact_in,
        target_chain,
        recipient,
        redeem_option,
        encoded_output_token,
    } = args;

    // Replace None with OutputToken::USDC encoded.
    let encoded_output_token = encoded_output_token.unwrap_or_else(|| {
        let mut buf = Vec::with_capacity(1);
        OutputToken::Usdc.write(&mut buf).unwrap();
        buf
    });
    let output_token = OutputToken::read(&mut &encoded_output_token[..]).unwrap();

    let is_usdc = ctx.accounts.src_mint.key() == common::USDC_MINT;

    // Swap layer does not support exact out for swaps (yet). We catch this before we reach the
    // initiate swap instruction.
    require!(is_usdc || is_exact_in, SwapLayerError::ExactInRequired);

    // We need to determine the relayer fee. This fee will either be paid for right now if
    // StagedInput::Usdc or will be deducted from the USDC after a resulting swap from the source
    // mint.
    //
    // NOTE: The swap instruction will revert if the amount of destination tokens is less than the
    // calculated relaying fee. The amount of source tokens should be sufficient enough to cover the
    // relaying fee after the swap.
    let (transfer_amount, staged_redeem) = match redeem_option {
        Some(redeem_option) => match redeem_option {
            RedeemOption::Relay {
                gas_dropoff,
                max_relayer_fee,
            } => {
                // Relaying fee must be less than the user-specific maximum.
                let relaying_fee = utils::relayer_fees::calculate_relayer_fee(
                    &ctx.accounts.target_peer.relay_params,
                    gas_dropoff,
                    &output_token,
                )?;
                require!(
                    relaying_fee <= max_relayer_fee,
                    SwapLayerError::ExceedsMaxRelayingFee
                );

                (
                    if is_usdc {
                        if is_exact_in {
                            require!(
                                amount_in > relaying_fee,
                                SwapLayerError::InsufficientAmountIn
                            );

                            amount_in
                        } else {
                            amount_in
                                .checked_add(relaying_fee)
                                .ok_or_else(|| SwapLayerError::U64Overflow)?
                        }
                    } else {
                        // Min amount out must cover the relaying fee. This unwrap should
                        // be fine since we've already checked that min_amount_out is Some
                        // in the account context.
                        require!(
                            min_amount_out.unwrap() > relaying_fee,
                            SwapLayerError::InsufficientAmountOut
                        );

                        amount_in
                    },
                    StagedRedeem::Relay {
                        gas_dropoff,
                        relaying_fee,
                    },
                )
            }
            RedeemOption::Payload(buf) => (amount_in, StagedRedeem::Payload(buf)),
        },
        None => (amount_in, StagedRedeem::Direct),
    };

    let src_token_program = &ctx.accounts.src_token_program;
    let custody_token = &ctx.accounts.staged_custody_token;
    let src_mint = &ctx.accounts.src_mint;
    let sender_token = ctx.accounts.sender_token.as_ref();

    let sender = match sender_token {
        Some(sender_token) => match (
            &ctx.accounts.sender,
            &ctx.accounts.program_transfer_authority,
        ) {
            (Some(sender), None) => {
                token_interface::transfer_checked(
                    CpiContext::new(
                        src_token_program.to_account_info(),
                        token_interface::TransferChecked {
                            from: sender_token.to_account_info(),
                            to: custody_token.to_account_info(),
                            authority: sender.to_account_info(),
                            mint: src_mint.to_account_info(),
                        },
                    ),
                    transfer_amount,
                    src_mint.decimals,
                )?;

                sender.key()
            }
            (None, Some(program_transfer_authority)) => {
                // If the program transfer authority is used, we require that the delegated amount
                // is exactly the amount being transferred.
                require_eq!(
                    sender_token.delegated_amount,
                    transfer_amount,
                    SwapLayerError::DelegatedAmountMismatch,
                );

                // And make sure the delegated authority is the program transfer authority.
                require!(
                    Option::<Pubkey>::from(sender_token.delegate)
                        .is_some_and(|delegate| { delegate == program_transfer_authority.key() }),
                    SwapLayerError::NotProgramTransferAuthority,
                );

                let (hashed_args, authority_bump) = last_transfer_authority_signer_seeds.unwrap();

                token_interface::transfer_checked(
                    CpiContext::new_with_signer(
                        src_token_program.to_account_info(),
                        token_interface::TransferChecked {
                            from: sender_token.to_account_info(),
                            to: custody_token.to_account_info(),
                            authority: program_transfer_authority.to_account_info(),
                            mint: src_mint.to_account_info(),
                        },
                        &[&[
                            crate::TRANSFER_AUTHORITY_SEED_PREFIX,
                            &hashed_args,
                            &[authority_bump],
                        ]],
                    ),
                    transfer_amount,
                    src_mint.decimals,
                )?;

                sender_token.owner
            }
            _ => return err!(SwapLayerError::EitherSenderOrProgramTransferAuthority),
        },
        None => match &ctx.accounts.sender {
            Some(sender) => {
                system_program::transfer(
                    CpiContext::new(
                        ctx.accounts.system_program.to_account_info(),
                        system_program::Transfer {
                            from: sender.to_account_info(),
                            to: custody_token.to_account_info(),
                        },
                    ),
                    transfer_amount,
                )?;

                let peer_seeds = &ctx.accounts.target_peer.seeds;
                token_interface::sync_native(CpiContext::new_with_signer(
                    src_token_program.to_account_info(),
                    token_interface::SyncNative {
                        account: custody_token.to_account_info(),
                    },
                    &[&[
                        Peer::SEED_PREFIX,
                        &peer_seeds.chain.to_be_bytes(),
                        &[peer_seeds.bump],
                    ]],
                ))?;

                sender.key()
            }
            None => return err!(SwapLayerError::SenderRequired),
        },
    };

    ctx.accounts.staged_outbound.set_inner(StagedOutbound {
        info: StagedOutboundInfo {
            custody_token_bump: ctx.bumps.staged_custody_token,
            prepared_by: ctx.accounts.payer.key(),
            usdc_refund_token: ctx.accounts.usdc_refund_token.key(),
            sender,
            target_chain,
            is_exact_in,
            recipient,
            min_amount_out,
        },
        staged_redeem,
        encoded_output_token,
    });

    // Done.
    Ok(())
}
