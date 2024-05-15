use anchor_lang::prelude::*;

#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct StagedInboundSeeds {
    pub prepared_fill: Pubkey,
    pub bump: u8,
}

#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct StagedInboundInfo {
    pub staged_custody_token_bump: u8,

    // Payer that created this StagedInbound.
    pub staged_by: Pubkey,

    // Exposed out of convenience for the receiving program.
    pub source_chain: u16,

    // pub payload_sender: [u8; 32],

    // The encoded recipient must be the caller.
    pub recipient: Pubkey,

    // Indicates whether the output token type is Gas.
    pub is_native: bool,
}

#[account]
#[derive(Debug)]
pub struct StagedInbound {
    pub seeds: StagedInboundSeeds,
    pub info: StagedInboundInfo,
    pub recipient_payload: Vec<u8>,
}

impl StagedInbound {
    pub const SEED_PREFIX: &'static [u8] = b"staged-inbound";

    pub fn checked_compute_size(payload_len: usize) -> Option<usize> {
        const FIXED: usize = 8 // DISCRIMINATOR
            + StagedInboundSeeds::INIT_SPACE
            + StagedInboundInfo::INIT_SPACE
            + 4 // payload len
        ;

        payload_len.checked_add(FIXED)
    }
}

impl std::ops::Deref for StagedInbound {
    type Target = StagedInboundInfo;

    fn deref(&self) -> &Self::Target {
        &self.info
    }
}
