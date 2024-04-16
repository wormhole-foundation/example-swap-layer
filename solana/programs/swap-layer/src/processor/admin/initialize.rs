use crate::{composite::*, error::SwapLayerError, state::Custodian};
use anchor_lang::prelude::*;
use anchor_spl::token;
//use wormhole_solana_utils::cpi::bpf_loader_upgradeable::{self, BpfLoaderUpgradeable};

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
            owner_assistant.key() != Pubkey::default()
        } @ SwapLayerError::AssistantZeroPubkey
    )]
    owner_assistant: UncheckedAccount<'info>,

    /// CHECK: This account must not be the zero pubkey.
    #[account(
        owner = Pubkey::default(),
        constraint = (
            fee_recipient.key() != Pubkey::default()
        ) @ SwapLayerError::FeeRecipientZeroPubkey
    )]
    fee_recipient: UncheckedAccount<'info>,

    #[account(
        associated_token::mint = usdc,
        associated_token::authority = fee_recipient,
    )]
    fee_recipient_token: Account<'info, token::TokenAccount>,

    /// CHECK: This account must not be the zero pubkey.
    #[account(
        owner = Pubkey::default(),
        constraint = {
            fee_updater.key() != Pubkey::default()
        } @ SwapLayerError::FeeUpdaterZeroPubkey
    )]
    fee_updater: UncheckedAccount<'info>,

    usdc: Usdc<'info>,

    // #[account(address = common::USDC_MINT)]
    // mint: Account<'info, token::Mint>,
    /// We use the program data to make sure this owner is the upgrade authority (the true owner,
    /// who deployed this program).
    // #[account(
    //     mut,
    //     seeds = [crate::ID.as_ref()],
    //     bump,
    //     seeds::program = bpf_loader_upgradeable::id(),
    //     constraint = {
    //         program_data.upgrade_authority_address.is_some()
    //     } @ TokenRouterError::ImmutableProgram
    // )]
    // program_data: Account<'info, ProgramData>,

    /// CHECK: This program PDA will be the upgrade authority for the Token Router program.
    // #[account(address = common::UPGRADE_MANAGER_AUTHORITY)]
    // upgrade_manager_authority: UncheckedAccount<'info>,

    /// CHECK: This program must exist.
    // #[account(
    //     executable,
    //     address = common::UPGRADE_MANAGER_PROGRAM_ID,
    // )]
    // upgrade_manager_program: UncheckedAccount<'info>,

    //bpf_loader_upgradeable_program: Program<'info, BpfLoaderUpgradeable>,
    system_program: Program<'info, System>,
    //token_program: Program<'info, token::Token>,
    //associated_token_program: Program<'info, anchor_spl::associated_token::AssociatedToken>,
}

pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
    let owner = ctx.accounts.owner.key();

    // We need to check that the upgrade authority is the owner passed into the account context.
    // #[cfg(not(feature = "integration-test"))]
    // {
    //     require_keys_eq!(
    //         ctx.accounts.owner.key(),
    //         ctx.accounts.program_data.upgrade_authority_address.unwrap(),
    //         TokenRouterError::OwnerOnly
    //     );

    //     bpf_loader_upgradeable::set_upgrade_authority(
    //         CpiContext::new(
    //             ctx.accounts
    //                 .bpf_loader_upgradeable_program
    //                 .to_account_info(),
    //             bpf_loader_upgradeable::SetUpgradeAuthority {
    //                 program_data: ctx.accounts.program_data.to_account_info(),
    //                 current_authority: ctx.accounts.owner.to_account_info(),
    //                 new_authority: Some(ctx.accounts.upgrade_manager_authority.to_account_info()),
    //             },
    //         ),
    //         &crate::id(),
    //     )?;
    // }

    ctx.accounts.custodian.set_inner(Custodian {
        owner,
        pending_owner: None,
        owner_assistant: ctx.accounts.owner_assistant.key(),
        fee_updater: ctx.accounts.fee_updater.key(),
        fee_recipient_token: ctx.accounts.fee_recipient_token.key(),
    });

    // Done.
    Ok(())
}