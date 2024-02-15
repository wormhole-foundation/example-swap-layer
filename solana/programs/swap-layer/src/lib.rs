use anchor_lang::prelude::*;

mod processor;
pub(crate) use processor::*;
mod state;
mod message;
mod error;

cfg_if::cfg_if! {
  if #[cfg(feature = "testnet")] {
    declare_id!("");
    const INSTANCE_BUMP: u8 = 255; //TODO
  } else if #[cfg(feature = "localnet")] {
    declare_id!("SwapLayer1111111111111111111111111111111111");
    const INSTANCE_BUMP: u8 = 255; //TODO
  }
}

#[program]
pub mod swap_layer {
  use super::*;

  pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
    processor::initialize(ctx)
  }

  pub fn redeem_no_swap(ctx: Context<RedeemCommon>) -> Result<()> {
    processor::redeem_no_swap(ctx)
  }

  pub fn redeem_orca_one_hop(ctx: Context<RedeemOrcaOneHop>) -> Result<()> {
    processor::redeem_orca_one_hop(ctx)
  }
}