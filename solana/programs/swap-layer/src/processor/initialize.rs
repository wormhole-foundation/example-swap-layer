use anchor_lang::prelude::*;
use anchor_spl::token;
use wormhole_solana_utils::cpi::bpf_loader_upgradeable as bpf;
use liquidity_layer_common_solana::constants::usdc::id as usdc_mint_address;
use crate::state::Instance;

#[derive(Accounts)]
pub struct Initialize<'info> {
  #[account(mut)]
  pub owner: Signer<'info>,

  pub upgrade_authority: Signer<'info>,

  #[account(
    init,
    payer = owner,
    space = 8 + Instance::INIT_SPACE,
    seeds = [Instance::SEED_PREFIX],
    bump,
  )]
  pub instance: Account<'info, Instance>,

  /// We use the program data to make sure this owner is the upgrade authority (the true owner,
  /// who deployed this program).
  #[account(
    mut,
    seeds = [crate::ID.as_ref()],
    bump,
    seeds::program = bpf::BpfLoaderUpgradeable::id(),
    constraint = {
      program_data.upgrade_authority_address == Some(*owner.key)
    }
  )]
  program_data: Account<'info, ProgramData>,

  #[account(address = usdc_mint_address())]
  usdc_mint: AccountInfo<'info>,

  #[account(
    init,
    payer = owner,
    associated_token::mint = usdc_mint,
    associated_token::authority = instance,
    //address = crate::transient_usdc_custody_address,
  )]
  transient_usdc_custody: Account<'info, token::TokenAccount>,

  system_program: Program<'info, System>,
  token_program: Program<'info, token::Token>,
  associated_token_program: Program<'info, anchor_spl::associated_token::AssociatedToken>,
  bpf_loader_upgradeable_program: Program<'info, bpf::BpfLoaderUpgradeable>,
}

pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
  let instance = &mut ctx.accounts.instance;
  instance.owner = *ctx.accounts.owner.key;

  bpf::set_upgrade_authority_checked(
    CpiContext::new_with_signer(
      ctx.accounts.bpf_loader_upgradeable_program.to_account_info(),
      bpf::SetUpgradeAuthorityChecked {
        program_data:      ctx.accounts.program_data.    to_account_info(),
        current_authority: ctx.accounts.upgrade_authority.to_account_info(),
        new_authority:     ctx.accounts.instance         .to_account_info(),
      },
      &[Instance::SIGNER_SEEDS],
    ),
  &crate::ID,
  )?;

  Ok(())
}