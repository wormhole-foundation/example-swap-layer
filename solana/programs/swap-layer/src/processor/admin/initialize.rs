use crate::{error::SwapLayerError, state::Custodian};
use anchor_lang::prelude::*;
use anchor_spl::token;

#[derive(Accounts)]
pub struct Initialize<'info> {
    /// Owner of the program, who presumably deployed this program.
    #[account(mut)]
    owner: Signer<'info>,

    #[account(
        init,
        payer = owner,
        space = 8 + Custodian::INIT_SPACE,
        seeds = [Custodian::SEED_PREFIX],
        bump,
    )]
    /// Sender Config account, which saves program data useful for other
    /// instructions, specifically for outbound transfers. Also saves the payer
    /// of the [`initialize`](crate::initialize) instruction as the program's
    /// owner.
    custodian: Account<'info, Custodian>,

    /// CHECK: This account must not be the zero pubkey.
    #[account(
        owner = Pubkey::default(),
        constraint = {
            require!(
                owner_assistant.key() != Pubkey::default(),
                SwapLayerError::AssistantZeroPubkey
            );

            true
        }
    )]
    owner_assistant: UncheckedAccount<'info>,

    /// CHECK: This account must not be the zero pubkey.
    #[account(
        owner = Pubkey::default(),
        constraint = {
            require!(
                fee_recipient.key() != Pubkey::default(),
                SwapLayerError::FeeRecipientZeroPubkey
            );

            true
        }
    )]
    fee_recipient: UncheckedAccount<'info>,

    #[account(
        associated_token::mint = common::USDC_MINT,
        associated_token::authority = fee_recipient,
    )]
    fee_recipient_token: Account<'info, token::TokenAccount>,

    /// CHECK: This account must not be the zero pubkey.
    #[account(
        owner = Pubkey::default(),
        constraint = {
            require!(
                fee_updater.key() != Pubkey::default(),
                SwapLayerError::FeeUpdaterZeroPubkey
            );

            true
        }
    )]
    fee_updater: UncheckedAccount<'info>,

    /// We use the program data to make sure this owner is the upgrade authority (the true owner,
    /// who deployed this program).
    #[account(
        mut,
        seeds = [crate::ID.as_ref()],
        bump,
        seeds::program = solana_program::bpf_loader_upgradeable::id(),
        constraint = match program_data.upgrade_authority_address {
            Some(upgrade_authority) => {
                #[cfg(feature = "integration-test")]
                let deployer = Pubkey::default();
                #[cfg(not(feature = "integration-test"))]
                let deployer = owner.key();

                require_keys_eq!(
                    deployer,
                    upgrade_authority,
                    SwapLayerError::OwnerOnly
                );

                true
            },
            _ => return err!(SwapLayerError::ImmutableProgram),
        }
    )]
    program_data: Account<'info, ProgramData>,

    system_program: Program<'info, System>,
}

pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
    ctx.accounts.custodian.set_inner(Custodian {
        owner: ctx.accounts.owner.key(),
        pending_owner: None,
        owner_assistant: ctx.accounts.owner_assistant.key(),
        fee_updater: ctx.accounts.fee_updater.key(),
        fee_recipient_token: ctx.accounts.fee_recipient_token.key(),
    });

    // Done.
    Ok(())
}
