use anchor_lang::prelude::*;

mod processor;
use processor::*;

mod composite;

mod error;

pub mod state;

pub mod utils;

declare_id!("AQFz751pSuxMX6PFWx9uruoVSZ3qay2Zi33MJ4NmUF2m");

const CUSTODIAN_BUMP: u8 = 255;
const SEED_PREFIX_TMP: &[u8] = b"tmp";

#[program]
pub mod swap_layer {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        processor::initialize(ctx)
    }

    pub fn complete_transfer_relay(ctx: Context<CompleteTransferRelay>) -> Result<()> {
        processor::complete_transfer_relay(ctx)
    }

    pub fn swap_jupiter_v6_shared_accounts_route_passthrough(
        ctx: Context<SwapJupiterV6SharedAccountsRoutePassthrough>,
        selector: [u8; 8],
        args: SwapJupiterV6SharedAccountsRoutePassthroughArgs,
    ) -> Result<()> {
        processor::swap_jupiter_v6_shared_accounts_route_passthrough(ctx, selector, args)
    }
}
