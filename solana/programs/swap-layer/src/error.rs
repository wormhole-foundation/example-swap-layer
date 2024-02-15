#[anchor_lang::prelude::error_code]
pub enum SwapLayerError {
  #[msg("redeem instruction type does not match redeem mode in payload")] 
  InvalidRedeemMode = 0x200,

  #[msg("relayer fee usdc account must match address in instance account")] 
  InvalidRelayerFeeUsdc = 0x201,

  #[msg("rent_recipient must match prepared_by address in prepared fill")] 
  InvalidRentRecipient = 0x202,
}