use crate::{
    composite::*,
    error::SwapLayerError,
    state::{Custodian, Peer, StagedOutbound},
    PREPARED_ORDER_SEED_PREFIX,
};
use anchor_lang::prelude::*;
use anchor_spl::{associated_token, token, token_interface};
use common::wormhole_io::TypePrefixedPayload;
use swap_layer_messages::types::RedeemMode;

#[derive(Accounts)]
pub struct InitiateSwapExactIn<'info> {
    #[account(mut)]
    payer: Signer<'info>,

    custodian: CheckedCustodian<'info>,

    /// CHECK: This account must be the one who paid to create the staged outbound account.
    #[account(
        mut,
        address = staged_outbound.info.prepared_by,
    )]
    prepared_by: UncheckedAccount<'info>,

    /// Staging for outbound transfer. This account has all of the instructions needed to initiate
    /// the transfer.
    ///
    /// This account may be closed by the end of the instruction if there is no dust after the swap.
    #[account(
        mut,
        constraint = staged_outbound.info.is_exact_in @ SwapLayerError::ExactInRequired,
    )]
    staged_outbound: Account<'info, StagedOutbound>,

    /// This custody token account may be closed by the end of the instruction if there is no dust
    /// after the swap.
    #[account(
        mut,
        token::mint = src_mint,
        token::authority = target_peer,
        token::token_program = src_token_program,
        seeds = [
            crate::STAGED_CUSTODY_TOKEN_SEED_PREFIX,
            staged_outbound.key().as_ref(),
        ],
        bump = staged_outbound.info.custody_token_bump,
    )]
    staged_custody_token: Box<InterfaceAccount<'info, token_interface::TokenAccount>>,

    /// CHECK: This account must equal the usdc refund token encoded in the staged outbound account.
    #[account(address = staged_outbound.usdc_refund_token)]
    usdc_refund_token: UncheckedAccount<'info>,

    /// Peer used to determine whether assets are sent to a valid destination.
    target_peer: RegisteredPeer<'info>,

    /// CHECK: Mutable, seeds must be \["prepared-order", staged_outbound.key()\]
    #[account(
        mut,
        seeds = [
            PREPARED_ORDER_SEED_PREFIX,
            staged_outbound.key().as_ref(),
        ],
        bump,
    )]
    prepared_order: UncheckedAccount<'info>,

    /// CHECK: Seeds must be \["swap-authority", prepared_order.key()\].
    #[account(
        seeds = [
            crate::SWAP_AUTHORITY_SEED_PREFIX,
            prepared_order.key().as_ref(),
        ],
        bump,
    )]
    swap_authority: UncheckedAccount<'info>,

    /// Temporary swap token account to receive source mint from the staged custody token. This
    /// account will be closed at the end of this instruction.
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = src_mint,
        associated_token::authority = swap_authority,
        associated_token::token_program = src_token_program
    )]
    src_swap_token: Box<InterfaceAccount<'info, token_interface::TokenAccount>>,

    /// Temporary swap token account to receive destination mint after the swap. This account will
    /// be closed at the end of this instruction.
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = usdc,
        associated_token::authority = swap_authority
    )]
    dst_swap_token: Box<Account<'info, token::TokenAccount>>,

    /// This account must be verified as the source mint for the swap.
    src_mint: Box<InterfaceAccount<'info, token_interface::Mint>>,

    /// This account must be verified as the destination mint for the swap.
    #[account(constraint = src_mint.key() != usdc.key() @ SwapLayerError::SameMint)]
    usdc: Usdc<'info>,

    /// CHECK: Token router config.
    token_router_custodian: UncheckedAccount<'info>,

    /// CHECK: Mutable, seeds must be \["prepared-custody", prepared_order.key()\]
    #[account(mut)]
    prepared_custody_token: UncheckedAccount<'info>,

    token_router_program: Program<'info, token_router::program::TokenRouter>,
    associated_token_program: Program<'info, associated_token::AssociatedToken>,
    src_token_program: Interface<'info, token_interface::TokenInterface>,
    token_program: Program<'info, token::Token>,
    system_program: Program<'info, System>,
}

pub fn initiate_swap_exact_in<'a, 'b, 'c, 'info>(
    ctx: Context<'a, 'b, 'c, 'info, InitiateSwapExactIn<'info>>,
    instruction_data: Vec<u8>,
) -> Result<()>
where
    'c: 'info,
{
    let src_token_program = &ctx.accounts.src_token_program;
    let custody_token = &ctx.accounts.staged_custody_token;

    let peer = &ctx.accounts.target_peer;
    let peer_signer_seeds = &[
        Peer::SEED_PREFIX,
        &peer.seeds.chain.to_be_bytes(),
        &[peer.seeds.bump],
    ];

    let src_mint = &ctx.accounts.src_mint;
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            src_token_program.to_account_info(),
            token_interface::TransferChecked {
                from: custody_token.to_account_info(),
                to: ctx.accounts.src_swap_token.to_account_info(),
                authority: peer.to_account_info(),
                mint: src_mint.to_account_info(),
            },
            &[peer_signer_seeds],
        ),
        custody_token.amount,
        src_mint.decimals,
    )?;

    let (shared_accounts_route, swap_args, _) =
        JupiterV6SharedAccountsRoute::set_up(ctx.remaining_accounts, &instruction_data[..])?;

    let swap_authority = &ctx.accounts.swap_authority;

    // Verify remaining accounts.
    {
        require_keys_eq!(
            shared_accounts_route.transfer_authority.key(),
            swap_authority.key(),
            SwapLayerError::InvalidSwapAuthority
        );
        require_keys_eq!(
            shared_accounts_route.src_custody_token.key(),
            ctx.accounts.src_swap_token.key(),
            SwapLayerError::InvalidSourceSwapToken
        );
        require_keys_eq!(
            shared_accounts_route.dst_custody_token.key(),
            ctx.accounts.dst_swap_token.key(),
            SwapLayerError::InvalidDestinationSwapToken
        );
        require_keys_eq!(
            shared_accounts_route.src_mint.key(),
            ctx.accounts.src_mint.key(),
            SwapLayerError::InvalidSourceMint
        );
        require_keys_eq!(
            shared_accounts_route.dst_mint.key(),
            common::USDC_MINT,
            SwapLayerError::InvalidDestinationMint
        );
    }

    let swap_msg = ctx.accounts.staged_outbound.to_swap_message_v1()?;

    let staged_outbound = &ctx.accounts.staged_outbound;
    let prepared_order = &ctx.accounts.prepared_order;

    let prepared_order_key = prepared_order.key();
    let swap_authority_seeds = &[
        crate::SWAP_AUTHORITY_SEED_PREFIX,
        prepared_order_key.as_ref(),
        &[ctx.bumps.swap_authority],
    ];

    // Execute swap. Keep in mind that exact in is not really exact in... so there may be residual.
    let (usdc_amount_out, src_dust) = shared_accounts_route.swap_exact_in(
        swap_args,
        swap_authority_seeds,
        ctx.remaining_accounts,
        Default::default(),
    )?;

    // Verify that the usdc_amount_out is larger than the encoded relaying fee
    // if the staged outbound is a relay.
    if let RedeemMode::Relay {
        gas_dropoff: _,
        relaying_fee,
    } = swap_msg.redeem_mode
    {
        require!(
            usdc_amount_out > relaying_fee.into(),
            SwapLayerError::InsufficientAmountOut
        );
    }

    let payer = &ctx.accounts.payer;
    let src_swap_token = &ctx.accounts.src_swap_token;

    let token_program = &ctx.accounts.token_program;
    let dst_swap_token = &ctx.accounts.dst_swap_token;
    let custodian = &ctx.accounts.custodian;

    token::approve(
        CpiContext::new_with_signer(
            token_program.to_account_info(),
            token::Approve {
                to: dst_swap_token.to_account_info(),
                delegate: custodian.to_account_info(),
                authority: swap_authority.to_account_info(),
            },
            &[swap_authority_seeds],
        ),
        usdc_amount_out,
    )?;

    // Prepare market order as custodian.
    token_router::cpi::prepare_market_order(
        CpiContext::new_with_signer(
            ctx.accounts.token_router_program.to_account_info(),
            token_router::cpi::accounts::PrepareMarketOrder {
                payer: payer.to_account_info(),
                custodian: token_router::cpi::accounts::CheckedCustodian {
                    custodian: ctx.accounts.token_router_custodian.to_account_info(),
                },
                program_transfer_authority: Default::default(),
                sender: custodian.to_account_info().into(),
                prepared_order: ctx.accounts.prepared_order.to_account_info(),
                sender_token: dst_swap_token.to_account_info(),
                refund_token: ctx.accounts.usdc_refund_token.to_account_info(),
                prepared_custody_token: ctx.accounts.prepared_custody_token.to_account_info(),
                usdc: token_router::cpi::accounts::Usdc {
                    mint: ctx.accounts.usdc.to_account_info(),
                },
                token_program: token_program.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
            },
            &[
                Custodian::SIGNER_SEEDS,
                &[
                    PREPARED_ORDER_SEED_PREFIX,
                    staged_outbound.key().as_ref(),
                    &[ctx.bumps.prepared_order],
                ],
            ],
        ),
        token_router::PrepareMarketOrderArgs {
            amount_in: usdc_amount_out,
            min_amount_out: Default::default(),
            target_chain: staged_outbound.target_chain,
            redeemer: ctx.accounts.target_peer.address,
            redeemer_message: swap_msg.to_vec(),
        },
    )?;

    //  Close the destination swap token account.
    token::close_account(CpiContext::new_with_signer(
        token_program.to_account_info(),
        token::CloseAccount {
            account: dst_swap_token.to_account_info(),
            destination: payer.to_account_info(),
            authority: swap_authority.to_account_info(),
        },
        &[swap_authority_seeds],
    ))?;

    // If there is residual, we keep the staged accounts open.
    if src_dust > 0 {
        msg!("Staged dust: {}", src_dust);

        // Transfer dust back to the custody token.
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                src_token_program.to_account_info(),
                token_interface::TransferChecked {
                    from: src_swap_token.to_account_info(),
                    to: custody_token.to_account_info(),
                    authority: swap_authority.to_account_info(),
                    mint: src_mint.to_account_info(),
                },
                &[swap_authority_seeds],
            ),
            src_dust,
            src_mint.decimals,
        )?;
    }

    // Close the source swap token account.
    token_interface::close_account(CpiContext::new_with_signer(
        src_token_program.to_account_info(),
        token_interface::CloseAccount {
            account: src_swap_token.to_account_info(),
            destination: payer.to_account_info(),
            authority: swap_authority.to_account_info(),
        },
        &[swap_authority_seeds],
    ))?;

    if src_dust == 0 {
        let prepared_by = &ctx.accounts.prepared_by;

        // Close the custody token account.
        token_interface::close_account(CpiContext::new_with_signer(
            src_token_program.to_account_info(),
            token_interface::CloseAccount {
                account: custody_token.to_account_info(),
                destination: prepared_by.to_account_info(),
                authority: peer.to_account_info(),
            },
            &[peer_signer_seeds],
        ))?;

        // Close the staged outbound account.
        ctx.accounts
            .staged_outbound
            .close(prepared_by.to_account_info())?;
    }

    // Done.
    Ok(())
}
