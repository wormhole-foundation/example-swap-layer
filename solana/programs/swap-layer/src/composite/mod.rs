use crate::state::Peer;
use crate::{error::SwapLayerError, state::Custodian};
use anchor_lang::prelude::*;
use anchor_spl::token;
use common::USDC_MINT;
use common::{admin::utils::assistant, wormhole_io::TypePrefixedPayload};
use std::ops::Deref;
use swap_layer_messages::messages::SwapMessageV1;
use token_router::state::PreparedFill;

use common::admin::utils::{assistant::only_authorized, ownable::only_owner};

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
    pub fill_custody_token: Account<'info, token::TokenAccount>,

    associated_peer: RegisteredPeer<'info>,

    /// CHECK: Recipient of lamports from closing the prepared_fill account.
    #[account(mut)]
    pub beneficiary: UncheckedAccount<'info>,

    pub token_router_program: Program<'info, token_router::program::TokenRouter>,
}

impl<'info> ConsumeSwapLayerFill<'info> {
    pub fn read_message_unchecked(&self) -> SwapMessageV1 {
        SwapMessageV1::read_slice(&self.fill.redeemer_message).unwrap()
    }
}

impl<'info> Deref for ConsumeSwapLayerFill<'info> {
    type Target = Account<'info, PreparedFill>;

    fn deref(&self) -> &Self::Target {
        &self.fill
    }
}
