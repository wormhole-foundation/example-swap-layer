use anchor_lang::prelude::*;

#[derive(Debug, Default, Clone, InitSpace, AnchorSerialize, AnchorDeserialize)]
pub enum ExecutionParams {
    #[default]
    None,
    Evm {
        // Wei/gas scaled by 1e6 (i.e. 1e3 = 1 gwei)
        gas_price: u32,
        // Margin for gas dropoff. This value is scaled 1e4 (e.g. 1000000 = 100.00%).
        gas_price_margin: u32,
    },
}

#[derive(Debug, Clone, AnchorSerialize, AnchorDeserialize, InitSpace)]
pub struct SwapTimeLimit {
    // Limit in seconds for fast fills.
    pub fast_limit: u16,
    // Limit in seconds for finalized fills.
    pub finalized_limit: u16,
}

#[derive(Debug, Clone, InitSpace, AnchorSerialize, AnchorDeserialize)]
pub struct RelayParams {
    // Atomic usdc (i.e. 6 decimals -> 1e6 = 1 usdc), max=disabled
    pub base_fee: u32,
    // Atomic usdc/token (e.g. 1e9 = 1000 usdc/ether (or sol))
    pub native_token_price: u64,
    // Specified in micro-ether (i.e. 1e6 = 1 ether && 1e6 = 1 sol). The receiving
    // contract will scale the gas dropoff values based on the native decimals.
    pub max_gas_dropoff: u32,
    // Margin for gas dropoff. This value is scaled 1e4 (e.g. 1000000 = 100.00%).
    pub gas_dropoff_margin: u32,
    // Execution parameters specific to the target chain's execution environment.
    pub execution_params: ExecutionParams,
    // Time limits for fast and finalized fills. If this timer is exceeded, the
    // relayer will be allowed to execute the `complete_transfer_relay` for a
    // message that is inteded to perform a swap.
    pub swap_time_limit: SwapTimeLimit,
}

#[derive(Debug, Clone, AnchorSerialize, AnchorDeserialize, InitSpace)]
pub struct PeerSeeds {
    /// Peer chain. Cannot equal `1` (Solana's Chain ID).
    pub chain: u16,
    pub bump: u8,
}

#[account]
#[derive(Debug, InitSpace)]
/// Foreign Peer account data.
pub struct Peer {
    pub seeds: PeerSeeds,
    /// Peer address. Cannot be zero address.
    pub address: [u8; 32],
    /// Relay parameters.
    pub relay_params: RelayParams,
}

impl Peer {
    pub const SEED_PREFIX: &'static [u8] = b"peer";
}
