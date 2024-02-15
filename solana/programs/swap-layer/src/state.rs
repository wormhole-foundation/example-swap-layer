use anchor_lang::prelude::*;
use crate::message::SwapMessage;

#[account]
#[derive(Debug, InitSpace)]
pub struct Instance {
  pub owner: Pubkey,
  pub owner_assistant: Pubkey,
  pub fee_updater: Pubkey,
  pub relayer_fee_usdc: Pubkey,
}

impl Instance {
  pub const SEED_PREFIX: &'static [u8] = b"instance";
  pub const BUMP: u8 = crate::INSTANCE_BUMP;
  pub const SIGNER_SEEDS: &'static [&'static [u8]] = &[Self::SEED_PREFIX, &[Self::BUMP]];
}

#[account]
#[derive(Debug, InitSpace)]
pub struct PreparedSwapFill {
  pub vaa_hash: [u8; 32],
  pub bump: u8,
  pub prepared_custody_token_bump: u8,

  pub prepared_by: Pubkey,

  pub _ignored_fill_type: u8,

  pub source_chain: u16,
  pub order_sender: [u8; 32],
  pub redeemer: Pubkey,
  pub _ignored_redeemer_message_length: u32,
  pub swap_message: SwapMessage,
}