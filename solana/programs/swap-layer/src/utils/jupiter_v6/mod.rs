pub mod cpi;
pub use cpi::SHARED_ACCOUNTS_ROUTE_SELECTOR;

mod types;
pub use types::*;

use solana_program::{pubkey, pubkey::Pubkey};

pub const JUPITER_V6_PROGRAM_ID: Pubkey = pubkey!("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");

pub const AUTHORITY_COUNT: u8 = 8;

#[allow(clippy::inconsistent_digit_grouping)]
pub const ONE_HUNDRED_PERCENT: u16 = 100_00;

pub fn compute_quoted_out_amount(limit_amount: u64, slippage_bps: u16) -> Option<u64> {
    if slippage_bps > ONE_HUNDRED_PERCENT {
        None
    } else {
        let factor = 1. - f64::from(slippage_bps) / f64::from(ONE_HUNDRED_PERCENT);

        // We are aware of the potential loss of precision here if the limit amount is > 52 bits.
        //
        // An example with WSOL, which is 9 decimals:
        //
        // If the limit amount were 2 ^ 52 - 1 = 4503599627370495, this would equate to roughly
        // 4,503,599 WSOL. At current day prices of $150, this would be worth 675,539,850 USDC.
        // There would never be a situation where the swap amount from USDC be this high.
        //
        // In an extreme scenario where the price drops by 99.9% (so this means a price of $0.15),
        // the swap amount would be 4,503,599 * 0.15 = 675,539.85 USDC. This is still too large of
        // a number to pass through the Swap Layer.
        #[allow(clippy::as_conversions)]
        #[allow(clippy::cast_precision_loss)]
        let quoted_out_amount = (limit_amount as f64) / factor;

        // We are fine to truncate here because we set the amount to the floor of the result. This
        // result will also not ever be negative, so we are not worried about sign loss.
        #[allow(clippy::as_conversions)]
        #[allow(clippy::cast_possible_truncation)]
        #[allow(clippy::cast_sign_loss)]
        let quoted_out_amount = quoted_out_amount.floor() as u64;

        quoted_out_amount.into()
    }
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn test_compute_quoted_out_amount() {
        let slippage_bps = 200;
        let limit_amount = 48_987_482_503;

        assert_eq!(
            compute_quoted_out_amount(limit_amount, slippage_bps).unwrap(),
            49_987_227_043
        );
    }

    #[test]
    fn test_invalid_slippage_bps() {
        let slippage_bps = 10001;
        let limit_amount = 48_987_482_503;

        assert_eq!(compute_quoted_out_amount(limit_amount, slippage_bps), None);
    }
}
