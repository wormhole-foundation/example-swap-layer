use std::ops::Deref;

use crate::{
    error::SwapLayerError,
    state::{Custodian, Peer},
    utils::{
        jupiter_v6::{self, cpi::SharedAccountsRouteArgs, JUPITER_V6_PROGRAM_ID},
        AnchorInstructionData,
    },
};
use anchor_lang::prelude::*;
use anchor_spl::{associated_token, token};
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
                associated_peer.seeds.chain,
                fill.source_chain,
                SwapLayerError::InvalidPeer,
            );

            require!(
                fill.order_sender == associated_peer.address,
                SwapLayerError::InvalidPeer
            );

            true
        }
    )]
    pub fill: Account<'info, PreparedFill>,

    /// Custody token account. This account will be closed at the end of this instruction. It just
    /// acts as a conduit to allow this program to be the transfer initiator in the CCTP message.
    ///
    /// CHECK: Mutable. Seeds must be \["custody"\, source_chain.to_be_bytes()].
    #[account(mut)]
    fill_custody_token: Box<Account<'info, token::TokenAccount>>,

    associated_peer: RegisteredPeer<'info>,

    /// CHECK: Recipient of lamports from closing the prepared_fill account.
    #[account(mut)]
    beneficiary: UncheckedAccount<'info>,

    token_router_program: Program<'info, token_router::program::TokenRouter>,
}

impl<'info> ConsumeSwapLayerFill<'info> {
    pub fn read_message_unchecked(&self) -> SwapMessageV1 {
        SwapMessageV1::read_slice(&self.fill.redeemer_message).unwrap()
    }

    // pub fn read_message_unchecked_boxed(&self) -> Box<SwapMessageV1> {
    //     SwapMessageV1::read_slice(&self.fill.redeemer_message)
    //         .map(Box::new)
    //         .unwrap()
    // }

    pub fn prepared_fill_key(&self) -> Pubkey {
        self.fill.key()
    }

    pub fn consume_prepared_fill(
        &self,
        dst_token: AccountInfo<'info>,
        token_program: AccountInfo<'info>,
    ) -> Result<u64> {
        let amount = self.fill_custody_token.amount;

        token_router::cpi::consume_prepared_fill(CpiContext::new_with_signer(
            self.token_router_program.to_account_info(),
            token_router::cpi::accounts::ConsumePreparedFill {
                redeemer: self.custodian.to_account_info(),
                beneficiary: self.beneficiary.to_account_info(),
                prepared_fill: self.fill.to_account_info(),
                dst_token,
                prepared_custody_token: self.fill_custody_token.to_account_info(),
                token_program,
            },
            &[Custodian::SIGNER_SEEDS],
        ))?;

        Ok(amount)
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

    #[account(
        constraint = {
            let swap_msg = consume_swap_layer_fill.read_message_unchecked();

            // Ensure that the output token is a swap token for Jupiter V6. If swap is not encoded,
            // we allow the recipient to perform the swap himself in a direct transfer.
            //
            // NOTE: The recipient must be equal to the payer if OutputToken::Usdc! This check is
            // not performed here, but should be performed with the account context composing with
            // this composite.
            let (expected_dst_mint, swap) = match &swap_msg.output_token {
                OutputToken::Usdc => {
                    require!(
                        matches!(swap_msg.redeem_mode, RedeemMode::Direct),
                        SwapLayerError::InvalidRedeemMode,
                    );

                    (Default::default(), None)
                },
                OutputToken::Gas(swap) => (token::spl_token::native_mint::id(), swap.into()),
                OutputToken::Other { address, swap } => (Pubkey::from(*address), swap.into()),
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
                    *deadline == 0 || Clock::get().unwrap().unix_timestamp <= i64::from(*deadline),
                    SwapLayerError::SwapPastDeadline,
                );

                // Just in case the encoded limit amount exceeds u64, we have nothing to do if
                // this message were misconfigured.
                u64::try_from(*limit_amount).map_err(|_| SwapLayerError::InvalidLimitAmount)?;
            }

            true
        }
    )]
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
        associated_token::authority = authority
    )]
    pub src_swap_token: Box<Account<'info, token::TokenAccount>>,

    /// Temporary swap token account to receive destination mint after the swap. This account will
    /// be closed at the end of this instruction.
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = dst_mint,
        associated_token::authority = authority
    )]
    pub dst_swap_token: Box<Account<'info, token::TokenAccount>>,

    /// This account must be verified as the source mint for the swap.
    pub usdc: Usdc<'info>,

    /// This account must be verified as the destination mint for the swap.
    #[account(constraint = usdc.key() != dst_mint.key() @ SwapLayerError::SameMint)]
    pub dst_mint: Box<Account<'info, token::Mint>>,

    pub token_program: Program<'info, token::Token>,
    associated_token_program: Program<'info, associated_token::AssociatedToken>,
    system_program: Program<'info, System>,
}

impl<'info> CompleteSwap<'info> {
    pub fn consume_prepared_fill(&mut self) -> Result<u64> {
        // Consume prepared fill.
        self.consume_swap_layer_fill.consume_prepared_fill(
            self.src_swap_token.to_account_info(),
            self.token_program.to_account_info(),
        )?;

        // Because the source swap account is an ATA, someone could create this account and sent some
        // arbitrary amount to it to disrupt the flow of this instruction. To be safe, we will reload
        // the source swap token account to grab its amount.
        self.src_swap_token.reload()?;

        Ok(self.src_swap_token.amount)
    }

    pub fn close_swap_accounts(
        &self,
        bumps: &CompleteSwapBumps,
        destination: AccountInfo<'info>,
    ) -> Result<()> {
        let prepared_key = self.prepared_fill_key();
        let swap_authority_seeds = &[
            crate::SWAP_AUTHORITY_SEED_PREFIX,
            prepared_key.as_ref(),
            &[bumps.authority],
        ];

        token::close_account(CpiContext::new_with_signer(
            self.token_program.to_account_info(),
            token::CloseAccount {
                account: self.src_swap_token.to_account_info(),
                destination: destination.to_account_info(),
                authority: self.authority.to_account_info(),
            },
            &[swap_authority_seeds],
        ))?;

        token::close_account(CpiContext::new_with_signer(
            self.token_program.to_account_info(),
            token::CloseAccount {
                account: self.dst_swap_token.to_account_info(),
                destination,
                authority: self.authority.to_account_info(),
            },
            &[swap_authority_seeds],
        ))
    }
}

impl<'info> Deref for CompleteSwap<'info> {
    type Target = ConsumeSwapLayerFill<'info>;

    fn deref(&self) -> &Self::Target {
        &self.consume_swap_layer_fill
    }
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

    pub fn invoke_cpi(
        &self,
        args: SharedAccountsRouteArgs,
        signer_seeds: &[&[u8]],
        cpi_remaining_accounts: Vec<AccountInfo<'info>>,
    ) -> Result<()> {
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
        )
    }
}
