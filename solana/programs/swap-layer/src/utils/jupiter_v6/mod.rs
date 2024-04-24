pub mod cpi;
pub use cpi::SHARED_ACCOUNTS_ROUTE_SELECTOR;

mod types;
pub use types::*;

use solana_program::{pubkey, pubkey::Pubkey};

pub const JUPITER_V6_PROGRAM_ID: Pubkey = pubkey!("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");

pub const AUTHORITY_COUNT: u8 = 8;
