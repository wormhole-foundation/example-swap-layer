use anchor_lang::prelude::*;

#[account]
#[derive(Default, InitSpace)]
/// Foreign emitter account data.
pub struct Peer {
    /// Emitter chain. Cannot equal `1` (Solana's Chain ID).
    pub chain: u16,
    /// Emitter address. Cannot be zero address.
    pub address: [u8; 32],
}

impl Peer {
    pub const SEED_PREFIX: &'static [u8] = b"peer";
}
