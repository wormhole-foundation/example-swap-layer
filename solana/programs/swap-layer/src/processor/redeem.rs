use anchor_lang::prelude::*;
use anchor_spl::token;
use whirlpool_cpi;
use token_router::program::TokenRouter as LiquidityLayer;

use crate::{
  error::SwapLayerError,
  message::{
    RedeemMode,
    SwapType,
  },
  state::{
    Instance,
    PreparedSwapFill,
  },
};

#[derive(Accounts)]
pub struct RedeemCommon<'info> {
  #[account(seeds = [Instance::SEED_PREFIX], bump = Instance::BUMP)]
  pub instance: Account<'info, Instance>,

  #[account(mut)]
  pub recipient_usdc: AccountInfo<'info>,

  pub custodian: AccountInfo<'info>,

  #[account(mut)]
  pub prepared_fill: Account<'info, PreparedSwapFill>,

  #[account(mut)]
  pub prepared_custody_token: Account<'info, token::TokenAccount>,

  #[account(mut, address = prepared_fill.prepared_by @ SwapLayerError::InvalidRentRecipient)]
  pub rent_recipient: AccountInfo<'info>,

  pub redeemer: Option<Signer<'info>>,

  #[account(mut, address = instance.relayer_fee_usdc @ SwapLayerError::InvalidRelayerFeeUsdc)]
  pub relayer_fee_usdc: Option<AccountInfo<'info>>,

  pub token_program: Program<'info, token::Token>,
  pub liquidity_layer_program: Program<'info, LiquidityLayer>,
}

pub fn redeem_no_swap(ctx: Context<RedeemCommon>) -> Result<()> {
  let swap_message = &ctx.accounts.prepared_fill.swap_message;
  let redeem_mode = &swap_message.redeem_mode;
  //TODO allowing willy-nilly self relays makes the relayer exploitable
  let is_direct = matches!(redeem_mode, RedeemMode::Direct);
  let is_relay  = matches!(redeem_mode, RedeemMode::Relay{..});
  require!(is_direct || is_relay, SwapLayerError::InvalidRedeemMode);
  if is_direct {
    require_keys_eq!(swap_message.recipient, *ctx.accounts.redeemer.as_ref().unwrap().key);
  }

  redeem_usdc(
    &ctx.accounts.recipient_usdc,
    &ctx.accounts.liquidity_layer_program,
    &ctx.accounts.custodian,
    &ctx.accounts.instance,
    &ctx.accounts.rent_recipient,
    &ctx.accounts.prepared_fill,
    &ctx.accounts.prepared_custody_token,
    &ctx.accounts.token_program,
  ).map(|_| ())
}

//Orca:
// one hop: https://github.com/orca-so/whirlpools/blob/main/programs/whirlpool/src/instructions/swap.rs
// two hop: https://github.com/orca-so/whirlpools/blob/main/programs/whirlpool/src/instructions/two_hop_swap.rs

#[derive(Accounts)]
pub struct OrcaSwapAccounts<'info> {
  #[account(mut)]
  pub whirlpool: AccountInfo<'info>,

  #[account(mut)]
  pub token_vault_a: AccountInfo<'info>,

  #[account(mut)]
  pub token_vault_b: AccountInfo<'info>,

  #[account(mut)]
  pub tick_array_0: AccountInfo<'info>,

  #[account(mut)]
  pub tick_array_1: AccountInfo<'info>,

  #[account(mut)]
  pub tick_array_2: AccountInfo<'info>,

  //TODO orca does not demand mutability at this stage but the doc says that
  //     the account is currently unused and I suspect that it will have to be
  //     marked as mut when they choose to use it which would break the
  //     interface, hence I am marking it as mut now (I asked on Discord
  //     and will update this comment once I get a response).
  #[account(mut)]
  pub oracle: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct RedeemOrcaOneHop<'info> {
  pub common: RedeemCommon<'info>,
  pub swap: OrcaSwapAccounts<'info>,

  #[account(mut)]
  pub transient_usdc_custody: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct RedeemOrcaTwoHop<'info> {
  pub common: RedeemCommon<'info>,
  pub first_hop: OrcaSwapAccounts<'info>,
  pub second_hop: OrcaSwapAccounts<'info>,

  #[account(mut)]
  pub transient_usdc_custody: AccountInfo<'info>,

  #[account(mut)]
  pub transient_intermediate_custody: AccountInfo<'info>,
}

pub fn redeem_orca_one_hop(ctx: Context<RedeemOrcaOneHop>) -> Result<()> {
  let swap_message = &ctx.accounts.common.prepared_fill.swap_message;
  // require!(
  //   matches!(swap_message.redeem_mode, RedeemMode::OrcaOneHop),
  //   SwapLayerError::InvalidRedeemMode
  // );

  let usdc_amount = redeem_usdc(
    &ctx.accounts.transient_usdc_custody,
    &ctx.accounts.common.liquidity_layer_program,
    &ctx.accounts.common.custodian,
    &ctx.accounts.common.instance,
    &ctx.accounts.common.rent_recipient,
    &ctx.accounts.common.prepared_fill,
    &ctx.accounts.common.prepared_custody_token,
    &ctx.accounts.common.token_program,
  )?;
  
  //whirlpool_cpi::whirlpool::swap()
  Ok(())
}

fn redeem_usdc<'info>(
  dst_token:              &AccountInfo<'info>,
  token_router_program:   &Program<'info, token_router::program::TokenRouter>,
  custodian:              &AccountInfo<'info>,
  instance:               &Account<'info, Instance>,
  rent_recipient:         &AccountInfo<'info>,
  prepared_fill:          &Account<'info, PreparedSwapFill>,
  prepared_custody_token: &Account<'info, token::TokenAccount>,
  token_program:          &Program<'info, token::Token>,
) -> Result<u64> {
  let amount = prepared_custody_token.amount;
  token_router::cpi::consume_prepared_fill(
    CpiContext::new_with_signer(
      token_router_program.to_account_info(),
      token_router::cpi::accounts::ConsumePreparedFill {
        custodian:              custodian             .to_account_info(),
        redeemer:               instance              .to_account_info(),
        rent_recipient:         rent_recipient        .to_account_info(),
        prepared_fill:          prepared_fill         .to_account_info(),
        dst_token:              dst_token             .to_account_info(),
        prepared_custody_token: prepared_custody_token.to_account_info(),
        token_program:          token_program         .to_account_info(),
      },
      &[Instance::SIGNER_SEEDS],
    ),
  )?;
  Ok(amount)
}