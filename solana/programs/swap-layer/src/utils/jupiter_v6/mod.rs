pub mod cpi;
pub use cpi::SHARED_ACCOUNTS_ROUTE_SELECTOR;

mod types;
pub use types::*;

use solana_program::{pubkey, pubkey::Pubkey};

pub const JUPITER_V6_PROGRAM_ID: Pubkey = pubkey!("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");

pub const AUTHORITY_COUNT: u8 = 8;
pub const MAX_SLIPPAGE_BPS: u16 = 10_000;

#[allow(clippy::arithmetic_side_effects)]
#[allow(clippy::as_conversions)]
#[allow(clippy::integer_division)]
pub const MAX_QUOTED_OUT_AMOUNT: u64 = u64::MAX / (MAX_SLIPPAGE_BPS as u64);

pub trait JupiterV6SwapExactIn {
    fn quoted_out_amount(&self) -> u64;

    fn slippage_bps(&self) -> u16;
}

impl JupiterV6SwapExactIn for cpi::SharedAccountsRouteArgs {
    fn quoted_out_amount(&self) -> u64 {
        self.quoted_out_amount
    }

    fn slippage_bps(&self) -> u16 {
        self.slippage_bps
    }
}

pub fn compute_min_amount_out(swap_args: &impl JupiterV6SwapExactIn) -> u64 {
    let quoted_out_amount = swap_args.quoted_out_amount();

    // In case the slippage bps is configured to be greater than the max, we will set it to the max
    // in this case because slippage cannot exceed 100%.
    let after_slippage_bps =
        MAX_SLIPPAGE_BPS.saturating_sub(swap_args.slippage_bps().min(MAX_SLIPPAGE_BPS));

    // Only upcast to u128 if the quoted out amount * 10_000 will overflow u64.
    if quoted_out_amount > MAX_QUOTED_OUT_AMOUNT {
        // There will be no side effects with this operation. And because MAX_SLIPPAGE_BPS is
        // greater than slippage_bps, the result will always be less than or equal to u64::MAX.
        #[allow(clippy::arithmetic_side_effects)]
        #[allow(clippy::as_conversions)]
        #[allow(clippy::cast_possible_truncation)]
        let limit_amount = u128::from(quoted_out_amount)
            .saturating_mul(after_slippage_bps.into())
            .saturating_div(MAX_SLIPPAGE_BPS.into()) as u64;

        limit_amount
    } else {
        // There are no side effects here because MAX_SLIPPAGE_BPS is not zero.
        #[allow(clippy::arithmetic_side_effects)]
        quoted_out_amount
            .checked_mul(after_slippage_bps.into())
            .unwrap() // Panic here in case of overflow (which should be impossible).
            .saturating_div(MAX_SLIPPAGE_BPS.into())
    }
}
