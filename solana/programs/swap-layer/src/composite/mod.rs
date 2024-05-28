use std::ops::Deref;

use crate::{
    error::SwapLayerError,
    state::{Custodian, Peer},
    utils::{
        self,
        jupiter_v6::{self, cpi::SharedAccountsRouteArgs, JUPITER_V6_PROGRAM_ID},
        AnchorInstructionData,
    },
};
use anchor_lang::{prelude::*, system_program};
use anchor_spl::{associated_token, token, token_interface};
use common::{
    admin::utils::{
        assistant::{self, only_authorized},
        ownable::only_owner,
    },
    wormhole_io::TypePrefixedPayload,
    USDC_MINT,
};
use swap_layer_messages::{
    messages::SwapMessageV1,
    types::{OutputSwap, OutputToken, RedeemMode, SwapType},
};
use token_router::state::PreparedFill;

#[derive(Accounts)]
pub struct Usdc<'info> {
    /// CHECK: This address must equal [USDC_MINT](common::USDC_MINT).
    #[account(address = USDC_MINT)]
    pub mint: UncheckedAccount<'info>,
}

impl<'info> Deref for Usdc<'info> {
    type Target = UncheckedAccount<'info>;

    fn deref(&self) -> &Self::Target {
        &self.mint
    }
}

#[derive(Accounts)]
pub struct CheckedCustodian<'info> {
    #[account(
        seeds = [Custodian::SEED_PREFIX],
        bump = Custodian::BUMP,
    )]
    pub custodian: Account<'info, Custodian>,
}

impl<'info> Deref for CheckedCustodian<'info> {
    type Target = Account<'info, Custodian>;

    fn deref(&self) -> &Self::Target {
        &self.custodian
    }
}

#[derive(Accounts)]
pub struct OwnerOnly<'info> {
    #[account(
        constraint = only_owner(
            &custodian,
            &owner,
            error!(SwapLayerError::OwnerOnly)
        )?
    )]
    pub owner: Signer<'info>,

    pub custodian: CheckedCustodian<'info>,
}

#[derive(Accounts)]
pub struct OwnerOnlyMut<'info> {
    #[account(
        constraint = only_owner(
            &custodian,
            &owner,
            error!(SwapLayerError::OwnerOnly)
        )?
    )]
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [Custodian::SEED_PREFIX],
        bump = Custodian::BUMP,
    )]
    pub custodian: Account<'info, Custodian>,
}

#[derive(Accounts)]
pub struct Admin<'info> {
    #[account(
        constraint = assistant::only_authorized(
            &custodian,
            &owner_or_assistant,
            error!(SwapLayerError::OwnerOrAssistantOnly)
        )?
    )]
    pub owner_or_assistant: Signer<'info>,

    pub custodian: CheckedCustodian<'info>,
}

#[derive(Accounts)]
pub struct AdminMut<'info> {
    #[account(
        constraint = only_authorized(
            &custodian,
            &owner_or_assistant,
            error!(SwapLayerError::OwnerOrAssistantOnly)
        )?
    )]
    pub owner_or_assistant: Signer<'info>,

    #[account(
        mut,
        seeds = [Custodian::SEED_PREFIX],
        bump = Custodian::BUMP,
    )]
    pub custodian: Account<'info, Custodian>,
}

#[derive(Accounts)]
pub struct FeeUpdater<'info> {
    #[account(
        constraint = {
            require!(
                fee_updater.key() == custodian.fee_updater.key()
                    || fee_updater.key() == custodian.owner.key()
                    || fee_updater.key() == custodian.owner_assistant.key(),
                SwapLayerError::InvalidFeeUpdater
            );

            true
        }
    )]
    pub fee_updater: Signer<'info>,

    pub custodian: CheckedCustodian<'info>,
}

#[derive(Accounts)]
pub struct RegisteredPeer<'info> {
    #[account(
        seeds = [
            Peer::SEED_PREFIX,
            &peer.seeds.chain.to_be_bytes()
        ],
        bump = peer.seeds.bump,
    )]
    peer: Box<Account<'info, Peer>>,
}

impl<'info> Deref for RegisteredPeer<'info> {
    type Target = Account<'info, Peer>;

    fn deref(&self) -> &Self::Target {
        &self.peer
    }
}

/// Prepared fill account with associated peer.
#[derive(Accounts)]
pub struct ConsumeSwapLayerFill<'info> {
    pub custodian: CheckedCustodian<'info>,

    #[account(
        mut,
        constraint = {
            let swap_msg = SwapMessageV1::read_slice(&fill.redeemer_message)
                .map_err(|_| SwapLayerError::InvalidSwapMessage)?;

            require_eq!(
                source_peer.seeds.chain,
                fill.source_chain,
                SwapLayerError::InvalidPeer,
            );

            require!(
                fill.order_sender == source_peer.address,
                SwapLayerError::InvalidPeer
            );

            true
        }
    )]
    pub fill: Box<Account<'info, PreparedFill>>,

    /// Custody token account. This account will be closed at the end of this instruction. It just
    /// acts as a conduit to allow this program to be the transfer initiator in the CCTP message.
    ///
    /// CHECK: Mutable. Seeds must be \["custody"\, source_chain.to_be_bytes()].
    #[account(mut)]
    fill_custody_token: UncheckedAccount<'info>,

    pub source_peer: RegisteredPeer<'info>,

    /// CHECK: Recipient of lamports from closing the prepared_fill account.
    #[account(mut)]
    beneficiary: UncheckedAccount<'info>,

    token_router_program: Program<'info, token_router::program::TokenRouter>,
}

impl<'info> ConsumeSwapLayerFill<'info> {
    pub fn read_message_unchecked(&self) -> SwapMessageV1 {
        SwapMessageV1::read_slice(&self.fill.redeemer_message).unwrap()
    }

    pub fn prepared_fill_key(&self) -> Pubkey {
        self.fill.key()
    }

    pub fn consume_prepared_fill(
        &self,
        dst_token: &AccountInfo<'info>,
        token_program: &AccountInfo<'info>,
    ) -> Result<u64> {
        token_router::cpi::consume_prepared_fill(CpiContext::new_with_signer(
            self.token_router_program.to_account_info(),
            token_router::cpi::accounts::ConsumePreparedFill {
                redeemer: self.custodian.to_account_info(),
                beneficiary: self.beneficiary.to_account_info(),
                prepared_fill: self.fill.to_account_info(),
                dst_token: dst_token.to_account_info(),
                prepared_custody_token: self.fill_custody_token.to_account_info(),
                token_program: token_program.to_account_info(),
            },
            &[Custodian::SIGNER_SEEDS],
        ))?;

        // Because the destination token account could have been created already, someone can send
        // some arbitrary amount to it. If this token account is meant to be closed sometime after
        // invoking this method, we want to make sure the amount we return will reflect however much
        // exists in the token account after consuming the prepared fill.
        token::TokenAccount::try_deserialize_unchecked(&mut &dst_token.data.borrow()[..])
            .map(|token| token.amount)
    }

    /// Ensure that the output token is a swap token for Jupiter V6. If swap is not encoded, we
    /// allow the recipient to perform the swap himself in a direct transfer.
    ///
    /// NOTE: The recipient must be equal to the payer if OutputToken::Usdc! This check is not
    /// performed here, but should be performed with the account context composing with this
    /// composite.
    pub fn is_valid_output_swap(&self, dst_mint: &AccountInfo) -> Result<bool> {
        let swap_msg = self.read_message_unchecked();

        let (expected_dst_mint, swap) = match swap_msg.output_token {
            OutputToken::Usdc => {
                require!(
                    matches!(swap_msg.redeem_mode, RedeemMode::Direct),
                    SwapLayerError::InvalidRedeemMode,
                );

                (Default::default(), None)
            }
            OutputToken::Gas(swap) => (token::spl_token::native_mint::id(), swap.into()),
            OutputToken::Other { address, swap } => (address.into(), swap.into()),
        };

        if let Some(swap) = swap {
            // Verify the address matches the destination mint.
            require_keys_eq!(
                dst_mint.key(),
                expected_dst_mint,
                SwapLayerError::InvalidDestinationMint
            );

            let OutputSwap {
                limit_amount,
                deadline,
                swap_type,
            } = swap;

            require!(
                matches!(swap_type, SwapType::JupiterV6(_)),
                SwapLayerError::InvalidSwapType,
            );

            // Check the deadline for the swap. There may not be a deadline check with the
            // dex that this instruction composes with, so we will check it here.
            //
            // TODO: Do we accept deadline == 0?
            require!(
                deadline == 0 || Clock::get().unwrap().unix_timestamp <= i64::from(deadline),
                SwapLayerError::SwapPastDeadline,
            );

            // Just in case the encoded limit amount exceeds u64, we have nothing to do if
            // this message were misconfigured.
            u64::try_from(limit_amount).map_err(|_| SwapLayerError::InvalidLimitAmount)?;
        }

        Ok(true)
    }
}

impl<'info> Deref for ConsumeSwapLayerFill<'info> {
    type Target = Account<'info, PreparedFill>;

    fn deref(&self) -> &Self::Target {
        &self.fill
    }
}

#[derive(Accounts)]
pub struct CompleteSwap<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(constraint = consume_swap_layer_fill.is_valid_output_swap(&dst_mint)?)]
    consume_swap_layer_fill: ConsumeSwapLayerFill<'info>,

    /// CHECK: Seeds must be \["swap-authority", prepared_fill.key()\].
    #[account(
        seeds = [
            crate::SWAP_AUTHORITY_SEED_PREFIX,
            consume_swap_layer_fill.key().as_ref(),
        ],
        bump,
    )]
    pub authority: UncheckedAccount<'info>,

    /// Temporary swap token account to receive USDC from the prepared fill. This account will be
    /// closed at the end of this instruction.
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = usdc,
        associated_token::authority = authority,
        associated_token::token_program = token_program
    )]
    pub src_swap_token: Box<Account<'info, token::TokenAccount>>,

    /// Temporary swap token account to receive destination mint after the swap. This account will
    /// be closed at the end of this instruction.
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = dst_mint,
        associated_token::authority = authority,
        associated_token::token_program = dst_token_program
    )]
    pub dst_swap_token: Box<InterfaceAccount<'info, token_interface::TokenAccount>>,

    /// This account must be verified as the source mint for the swap.
    pub usdc: Usdc<'info>,

    /// CHECK: This account must be verified as the destination mint for the swap.
    #[account(constraint = usdc.key() != dst_mint.key() @ SwapLayerError::SameMint)]
    pub dst_mint: UncheckedAccount<'info>,

    pub token_program: Program<'info, token::Token>,
    pub dst_token_program: Interface<'info, token_interface::TokenInterface>,
    associated_token_program: Program<'info, associated_token::AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub struct HandleCompleteSwap<'ctx, 'info> {
    pub payer: &'ctx Signer<'info>,
    pub consume_swap_layer_fill: &'ctx ConsumeSwapLayerFill<'info>,
    pub authority: &'ctx AccountInfo<'info>,
    pub src_swap_token: &'ctx Account<'info, token::TokenAccount>,
    pub dst_swap_token: &'ctx InterfaceAccount<'info, token_interface::TokenAccount>,
    pub dst_mint: &'ctx UncheckedAccount<'info>,
    pub token_program: &'ctx Program<'info, token::Token>,
    pub dst_token_program: &'ctx Interface<'info, token_interface::TokenInterface>,
    pub system_program: &'ctx Program<'info, System>,
}

impl<'info> CompleteSwap<'info> {
    pub fn custodian(&self) -> &CheckedCustodian<'info> {
        &self.consume_swap_layer_fill.custodian
    }

    pub fn consume_prepared_fill(&mut self) -> Result<u64> {
        self.consume_swap_layer_fill
            .consume_prepared_fill(self.src_swap_token.as_ref().as_ref(), &self.token_program)
    }
}

impl<'info> Deref for CompleteSwap<'info> {
    type Target = ConsumeSwapLayerFill<'info>;

    fn deref(&self) -> &Self::Target {
        &self.consume_swap_layer_fill
    }
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn complete_swap_jup_v6<'info>(
    complete_swap: &CompleteSwap<'info>,
    bumps: &CompleteSwapBumps,
    remaining_accounts: &'info [AccountInfo<'info>],
    ix_data: Vec<u8>,
    in_amount: u64,
    swap_message: SwapMessageV1,
    recipient: &AccountInfo<'info>,
    recipient_token: &AccountInfo<'info>,
    gas_dropoff: Option<u64>,
) -> Result<()> {
    let CompleteSwap {
        payer,
        consume_swap_layer_fill,
        authority,
        src_swap_token,
        dst_swap_token,
        dst_mint,
        token_program,
        dst_token_program,
        system_program,
        ..
    } = &complete_swap;

    handle_complete_swap_jup_v6(
        HandleCompleteSwap {
            payer,
            consume_swap_layer_fill,
            authority,
            src_swap_token,
            dst_swap_token,
            dst_mint,
            token_program,
            dst_token_program,
            system_program,
        },
        crate::SWAP_AUTHORITY_SEED_PREFIX,
        bumps.authority,
        remaining_accounts,
        ix_data,
        in_amount,
        swap_message,
        RecipientAccounts {
            recipient,
            recipient_token,
        }
        .into(),
        gas_dropoff,
    )
}

pub struct RecipientAccounts<'ctx, 'info> {
    pub recipient: &'ctx AccountInfo<'info>,
    pub recipient_token: &'ctx AccountInfo<'info>,
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn handle_complete_swap_jup_v6<'ctx, 'info>(
    accounts: HandleCompleteSwap<'ctx, 'info>,
    swap_authority_seed_prefix: &'static [u8],
    swap_authority_bump_seed: u8,
    remaining_accounts: &'info [AccountInfo<'info>],
    ix_data: Vec<u8>,
    in_amount: u64,
    swap_message: SwapMessageV1,
    recipient: Option<RecipientAccounts<'ctx, 'info>>,
    gas_dropoff: Option<u64>,
) -> Result<()> {
    let SwapMessageV1 {
        recipient: expected_recipient,
        output_token,
        redeem_mode: _,
    } = swap_message;

    let recipient_key = recipient.as_ref().map(|accounts| accounts.recipient.key());
    if let Some(recipient_key) = recipient_key {
        require_keys_eq!(
            recipient_key,
            Pubkey::from(expected_recipient),
            SwapLayerError::InvalidRecipient
        );
    }

    let (limit_and_params, is_native) = match output_token {
        OutputToken::Usdc => match recipient_key {
            Some(recipient_key) => {
                // In this case, we require that the signer of the instruction (the payer) is the
                // recipient himself.
                require_keys_eq!(
                    accounts.payer.key(),
                    recipient_key,
                    SwapLayerError::InvalidRecipient
                );

                (Default::default(), Default::default())
            }
            None => return err!(SwapLayerError::InvalidOutputToken),
        },
        OutputToken::Gas(OutputSwap {
            deadline: _,
            limit_amount,
            swap_type: SwapType::JupiterV6(swap_params),
        }) => ((limit_amount.try_into().unwrap(), swap_params).into(), true),
        OutputToken::Other {
            address: _,
            swap:
                OutputSwap {
                    deadline: _,
                    limit_amount,
                    swap_type: SwapType::JupiterV6(swap_params),
                },
        } => (
            (limit_amount.try_into().unwrap(), swap_params).into(),
            false,
        ),
        _ => return err!(SwapLayerError::InvalidOutputToken),
    };

    let swap_authority = accounts.authority;

    let prepared_fill_key = accounts.consume_swap_layer_fill.prepared_fill_key();
    let swap_authority_seeds = &[
        swap_authority_seed_prefix,
        prepared_fill_key.as_ref(),
        &[swap_authority_bump_seed],
    ];

    let (shared_accounts_route, mut swap_args, cpi_remaining_accounts) =
        JupiterV6SharedAccountsRoute::set_up(remaining_accounts, &ix_data[..])?;

    // Verify remaining accounts.
    {
        require_keys_eq!(
            shared_accounts_route.transfer_authority.key(),
            swap_authority.key(),
            SwapLayerError::InvalidSwapAuthority
        );
        require_keys_eq!(
            shared_accounts_route.src_custody_token.key(),
            accounts.src_swap_token.key(),
            SwapLayerError::InvalidSourceSwapToken
        );
        require_keys_eq!(
            shared_accounts_route.dst_custody_token.key(),
            accounts.dst_swap_token.key(),
            SwapLayerError::InvalidDestinationSwapToken
        );
        require_keys_eq!(
            shared_accounts_route.src_mint.key(),
            common::USDC_MINT,
            SwapLayerError::InvalidSourceMint
        );
        require_keys_eq!(
            shared_accounts_route.dst_mint.key(),
            accounts.dst_mint.key(),
            SwapLayerError::InvalidDestinationMint
        );
    }

    let limit_amount = match limit_and_params {
        // If the limit amount is some value (meaning that the OutputToken is Gas or Other), we
        // will override the instruction arguments with the limit amount and slippage == 0 bps.
        // Otherwise we will compute the limit amount using the given swap args.
        Some((limit_amount, swap_params)) => {
            msg!(
                "Override in_amount: {}, quoted_out_amount: {}, slippage_bps: {}",
                swap_args.in_amount,
                swap_args.quoted_out_amount,
                swap_args.slippage_bps
            );
            swap_args.in_amount = in_amount;
            swap_args.quoted_out_amount = limit_amount;
            swap_args.slippage_bps = 0;

            // Peek into the head of remaining accounts. This account will be the dex program that Jupiter
            // V6 interacts with. If the swap params specify a specific dex program, we need to ensure that
            // the one passed into this instruction handler is that.
            if let Some(dex_program_id) = swap_params.dex_program_id {
                require_eq!(
                    swap_args.route_plan.len(),
                    1,
                    SwapLayerError::NotJupiterV6DirectRoute
                );
                require_keys_eq!(
                    cpi_remaining_accounts[0].key(),
                    Pubkey::from(dex_program_id),
                    SwapLayerError::JupiterV6DexProgramMismatch
                );
            }

            limit_amount.into()
        }
        None => {
            // Fetched swap args should have the same in amount as the prepared (fast) fill.
            require_eq!(
                swap_args.in_amount,
                in_amount,
                SwapLayerError::InvalidSwapInAmount
            );

            None
        }
    };

    // Execute swap.
    let amount_out = shared_accounts_route.swap_exact_in(
        swap_args,
        swap_authority_seeds,
        cpi_remaining_accounts,
        limit_amount,
    )?;

    let payer = accounts.payer;

    token::close_account(CpiContext::new_with_signer(
        accounts.token_program.to_account_info(),
        token::CloseAccount {
            account: accounts.src_swap_token.to_account_info(),
            destination: payer.to_account_info(),
            authority: accounts.authority.to_account_info(),
        },
        &[swap_authority_seeds],
    ))?;

    if let Some(RecipientAccounts {
        recipient,
        recipient_token,
    }) = recipient
    {
        // We perform a token transfer if the output token is not gas.
        if is_native {
            // NOTE: If the output token is gas, lamports reflecting the WSOL amount will be transferred to
            // the recipient's account. We first close and send all lamports to the payer.
            token_interface::close_account(CpiContext::new_with_signer(
                accounts.dst_token_program.to_account_info(),
                token_interface::CloseAccount {
                    account: accounts.dst_swap_token.to_account_info(),
                    destination: payer.to_account_info(),
                    authority: accounts.authority.to_account_info(),
                },
                &[swap_authority_seeds],
            ))?;

            // Then transfer amount_out to recipient.
            system_program::transfer(
                CpiContext::new(
                    accounts.system_program.to_account_info(),
                    system_program::Transfer {
                        from: payer.to_account_info(),
                        to: recipient.to_account_info(),
                    },
                ),
                amount_out
                    .checked_add(gas_dropoff.unwrap_or_default())
                    .ok_or(SwapLayerError::U64Overflow)?,
            )?
        } else {
            // Verify that the encoded owner is the actual owner. ATAs are no different from other token
            // accounts, so anyone can set the authority of an ATA to be someone else.
            {
                let recipient_token_owner =
                    token::TokenAccount::try_deserialize(&mut &recipient_token.data.borrow()[..])
                        .map(|token| token.owner)?;
                require_keys_eq!(
                    recipient_token_owner,
                    recipient.key(),
                    ErrorCode::ConstraintTokenOwner,
                );
            }

            // Transfer destination tokens to recipient.
            token::transfer(
                CpiContext::new_with_signer(
                    accounts.token_program.to_account_info(),
                    token::Transfer {
                        from: accounts.dst_swap_token.to_account_info(),
                        to: recipient_token.to_account_info(),
                        authority: swap_authority.to_account_info(),
                    },
                    &[swap_authority_seeds],
                ),
                amount_out,
            )?;

            // Close the destination swap token account.
            token_interface::close_account(CpiContext::new_with_signer(
                accounts.dst_token_program.to_account_info(),
                token_interface::CloseAccount {
                    account: accounts.dst_swap_token.to_account_info(),
                    destination: payer.to_account_info(),
                    authority: accounts.authority.to_account_info(),
                },
                &[swap_authority_seeds],
            ))?;

            // If there is a gas dropoff, transfer it to the recipient.
            match gas_dropoff {
                Some(gas_dropoff) if gas_dropoff > 0 => system_program::transfer(
                    CpiContext::new(
                        accounts.system_program.to_account_info(),
                        system_program::Transfer {
                            from: payer.to_account_info(),
                            to: recipient.to_account_info(),
                        },
                    ),
                    gas_dropoff,
                )?,
                _ => (),
            }
        }
    }

    // Done.
    Ok(())
}

////////////////////////////////////////////////////////////////////////////////////////////////////
//
//  Jupiter V6 handling.
//
////////////////////////////////////////////////////////////////////////////////////////////////////

#[derive(Accounts)]
#[instruction(args: SharedAccountsRouteArgs)]
pub struct JupiterV6SharedAccountsRoute<'info> {
    pub token_program: Program<'info, token::Token>,

    /// We can lean on Jupiter V6 CPI failing if this is not valid. But we are
    /// being extra sure about the authority. Per Jupiter's documentation, there
    /// are only 8 authorities.
    ///
    /// CHECK: Seeds must be \["authority", id\] (Jupiter V6 Program).
    #[account(
        seeds = [
            b"authority",
            &[args.authority_id],
        ],
        bump,
        seeds::program = jupiter_v6_program,
        constraint = {
            require!(
                args.authority_id <= jupiter_v6::AUTHORITY_COUNT,
                SwapLayerError::InvalidJupiterV6AuthorityId,
            );

            true
        }
    )]
    pub jupiter_v6_authority: UncheckedAccount<'info>,

    /// CHECK: This account will be the Swap Layer's swap authority.
    pub transfer_authority: UncheckedAccount<'info>,

    /// CHECK: This account will be the Swap Layer's source token account.
    #[account(mut)]
    pub src_custody_token: UncheckedAccount<'info>,

    #[account(
        mut,
        associated_token::mint = src_mint,
        associated_token::authority = jupiter_v6_authority,
    )]
    pub jupiter_v6_src_custody_token: Box<Account<'info, token::TokenAccount>>,

    #[account(
        mut,
        associated_token::mint = dst_mint,
        associated_token::authority = jupiter_v6_authority,
    )]
    pub jupiter_v6_dst_custody_token: Box<Account<'info, token::TokenAccount>>,

    /// CHECK: This account will be the Swap Layer's destination token account.
    #[account(mut)]
    pub dst_custody_token: UncheckedAccount<'info>,

    /// CHECK: This account must be the source mint for the swap.
    pub src_mint: UncheckedAccount<'info>,

    /// CHECK: This account must be the destination mint for the swap.
    pub dst_mint: UncheckedAccount<'info>,

    /// CHECK: This is an optional account, which we will enforce to be None (so it will be passed
    /// in as the Jupiter V6 program ID) because Swap Layer will not collect platform fees.
    #[account(address = jupiter_v6::JUPITER_V6_PROGRAM_ID)]
    pub platform_fee_none: UncheckedAccount<'info>,

    /// CHECK: Token 2022 program is optional.
    pub token_2022_program: UncheckedAccount<'info>,

    /// CHECK: Seeds must be \["__event_authority"\] (Jupiter V6 Program).
    pub jupiter_v6_event_authority: UncheckedAccount<'info>,

    /// CHECK: Must equal Jupiter V6 Program ID.
    #[account(address = jupiter_v6::JUPITER_V6_PROGRAM_ID)]
    pub jupiter_v6_program: UncheckedAccount<'info>,
}

impl<'info> JupiterV6SharedAccountsRoute<'info> {
    pub fn set_up(
        mut cpi_account_infos: &'info [AccountInfo<'info>],
        ix_data: &[u8],
    ) -> Result<(Self, SharedAccountsRouteArgs, Vec<AccountInfo<'info>>)> {
        // Deserialize Jupiter V6 shared accounts route args.
        let args = AnchorInstructionData::deserialize_checked(ix_data)?;

        // Now try account infos.
        let accounts = JupiterV6SharedAccountsRoute::try_accounts(
            &JUPITER_V6_PROGRAM_ID,
            &mut cpi_account_infos,
            &ix_data[8..],
            &mut JupiterV6SharedAccountsRouteBumps {
                jupiter_v6_authority: Default::default(),
            },
            &mut Default::default(),
        )?;

        Ok((accounts, args, cpi_account_infos.to_vec()))
    }

    pub fn swap_exact_in(
        &self,
        args: SharedAccountsRouteArgs,
        signer_seeds: &[&[u8]],
        cpi_remaining_accounts: Vec<AccountInfo<'info>>,
        limit_amount: Option<u64>,
    ) -> Result<u64> {
        let limit_amount = limit_amount.unwrap_or(utils::jupiter_v6::compute_min_amount_out(&args));

        jupiter_v6::cpi::shared_accounts_route(
            CpiContext::new_with_signer(
                self.jupiter_v6_program.to_account_info(),
                jupiter_v6::cpi::SharedAccountsRoute {
                    token_program: self.token_program.to_account_info(),
                    program_authority: self.jupiter_v6_authority.to_account_info(),
                    user_transfer_authority: self.transfer_authority.to_account_info(),
                    source_token: self.src_custody_token.to_account_info(),
                    program_source_token: self.jupiter_v6_src_custody_token.to_account_info(),
                    program_destination_token: self.jupiter_v6_dst_custody_token.to_account_info(),
                    destination_account: self.dst_custody_token.to_account_info(),
                    source_mint: self.src_mint.to_account_info(),
                    destination_mint: self.dst_mint.to_account_info(),
                    platform_fee: Default::default(),
                    token_2022_program: self.token_2022_program.to_account_info().into(),
                    event_authority: self.jupiter_v6_event_authority.to_account_info(),
                    program: self.jupiter_v6_program.to_account_info(),
                },
                &[signer_seeds],
            )
            .with_remaining_accounts(cpi_remaining_accounts),
            args,
        )?;

        // After the swap, we reload the destination token account to get the correct amount.
        let amount_out = token::TokenAccount::try_deserialize_unchecked(
            &mut &self.dst_custody_token.data.borrow()[..],
        )
        .map(|token| token.amount)?;

        // Rarely do I use the gte macro, but this is a good use case for it. I want to display the
        // amounts if the limit amount is not met.
        require_gte!(amount_out, limit_amount, SwapLayerError::SwapFailed);

        Ok(amount_out)
    }
}
