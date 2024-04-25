use anchor_lang::prelude::*;

#[derive(Debug, Default, Clone, InitSpace, AnchorSerialize, AnchorDeserialize)]
pub enum ExecutionParams {
    #[default]
    None,
    Evm {
        gas_price: u32,
        gas_price_margin: u32,
    },
}

#[derive(Debug, Default, Clone, InitSpace, AnchorSerialize, AnchorDeserialize)]
pub struct RelayParams {
    pub base_fee: u32,
    pub native_token_price: u64,
    pub max_gas_dropoff: u64,
    pub gas_dropoff_margin: u32,
    pub execution_params: ExecutionParams,
}

#[account]
#[derive(Default, InitSpace)]
/// Foreign Peer account data.
pub struct Peer {
    /// Peer chain. Cannot equal `1` (Solana's Chain ID).
    pub chain: u16,
    /// Peer address. Cannot be zero address.
    pub address: [u8; 32],
    /// Relay parameters.
    pub relay_params: RelayParams,
}

impl Peer {
    pub const SEED_PREFIX: &'static [u8] = b"peer";
}
