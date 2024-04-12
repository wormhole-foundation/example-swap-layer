use anchor_lang::prelude::*;

mod processor;
use processor::*;

pub mod utils;

declare_id!("AQFz751pSuxMX6PFWx9uruoVSZ3qay2Zi33MJ4NmUF2m");

#[program]
pub mod swap_layer {
    use super::*;

    pub fn initialize(_ctx: Context<Initialize>) -> Result<()> {
        Ok(())
    }

    pub fn swap_jupiter_v6_shared_accounts_route(
        ctx: Context<SwapJupiterV6SharedAccountsRoute>,
        selector: [u8; 8],
        args: SwapJupiterV6SharedAccountsRouteArgs,
    ) -> Result<()> {
        processor::swap_jupiter_v6_shared_accounts_route(ctx, selector, args)
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    /// CHECK: dummy
    dummy: UncheckedAccount<'info>,
}
