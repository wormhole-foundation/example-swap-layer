use std::ops::Deref;

use crate::{error::SwapLayerError, state::Custodian, state::Peer};
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
    types::{OutputToken, SwapType},
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
            &peer.chain.to_be_bytes()
        ],
        bump,
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
                associated_peer.chain,
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
    payer: Signer<'info>,

    #[account(
        constraint = {
            let swap_msg = consume_swap_layer_fill.read_message_unchecked();

            // Ensure that the output token is a swap token for Jupiter V6.
            let (expected_dst_mint, swap) = match &swap_msg.output_token {
                OutputToken::Gas(swap) => (token::spl_token::native_mint::id(), swap),
                OutputToken::Other { address, swap } => (Pubkey::from(*address), swap),
                _ => return err!(SwapLayerError::InvalidOutputToken),
            };

            require!(
                matches!(swap.swap_type, SwapType::JupiterV6(_)),
                SwapLayerError::InvalidSwapType,
            );

            // Verify the address matches the destination mint.
            require_keys_eq!(
                dst_mint.key(),
                expected_dst_mint,
                SwapLayerError::InvalidDestinationMint
            );

            // Check the deadline for the swap. There may not be a deadline check with the
            // dex that this instruction composes with, so we will check it here.
            //
            // TODO: Do we accept deadline == 0?
            require!(
                swap.deadline == 0
                    || Clock::get().unwrap().unix_timestamp <= i64::from(swap.deadline),
                SwapLayerError::SwapPastDeadline,
            );

            // Just in case the encoded limit amount exceeds u64, we have nothing to do if
            // this message were misconfigured.
            u64::try_from(swap.limit_amount).map_err(|_| SwapLayerError::InvalidLimitAmount)?;

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
        associated_token::mint = src_mint,
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
    pub src_mint: Box<Account<'info, token::Mint>>,

    /// This account must be verified as the destination mint for the swap.
    #[account(constraint = src_mint.key() != dst_mint.key() @ SwapLayerError::SameMint)]
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

// fn require_jupiter_v6_output_swap(swap: &OutputSwap) -> Result<()> {
//     // Check the deadline for the swap. There may not be a deadline check with the
//     // dex that this instruction composes with, so we will check it here.
//     //
//     // TODO: Do we accept deadline == 0?
//     require!(
//         swap.deadline == 0 || Clock::get().unwrap().unix_timestamp <= i64::from(swap.deadline),
//         SwapLayerError::SwapPastDeadline,
//     );

//     // Just in case the encoded limit amount exceeds u64, we have nothing to do if
//     // this message were misconfigured.
//     u64::try_from(swap.limit_amount).map_err(|_| SwapLayerError::InvalidLimitAmount)?;

//     // Done.
//     Ok(())
// }
