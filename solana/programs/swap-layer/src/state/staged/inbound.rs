use anchor_lang::prelude::*;
use swap_layer_messages::{messages::SwapMessageV1, types::RedeemMode};

use crate::error::SwapLayerError;

#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone, Default, PartialEq, Eq, InitSpace)]
pub struct StagedInboundSeeds {
    pub prepared_fill: Pubkey,
    pub bump: u8,
}

#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct StagedInboundInfo {
    pub custody_token: Pubkey,

    /// Payer that created this StagedInbound.
    pub staged_by: Pubkey,

    /// Exposed out of convenience for the receiving program.
    pub source_chain: u16,

    /// The sender of the swap message.
    pub sender: [u8; 32],

    /// The encoded recipient must be the caller.
    pub recipient: Pubkey,

    /// Indicates whether the output token type is Gas.
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

    pub fn try_compute_size(swap_msg: SwapMessageV1) -> Result<usize> {
        const FIXED: usize = 8 // DISCRIMINATOR
            + StagedInboundSeeds::INIT_SPACE
            + StagedInboundInfo::INIT_SPACE
            + 4 // payload len
        ;

        match swap_msg.redeem_mode {
            RedeemMode::Payload { sender: _, buf } => buf
                .len()
                .checked_add(FIXED)
                .ok_or_else(|| error!(SwapLayerError::PayloadTooLarge)),
            _ => err!(SwapLayerError::InvalidRedeemMode),
        }
    }

    pub fn try_compute_size_if_needed(
        acc_info: &AccountInfo,
        swap_msg: SwapMessageV1,
    ) -> Result<usize> {
        if acc_info.data_is_empty() {
            Self::try_compute_size(swap_msg)
        } else {
            Ok(acc_info.data_len())
        }
    }
}

impl std::ops::Deref for StagedInbound {
    type Target = StagedInboundInfo;

    fn deref(&self) -> &Self::Target {
        &self.info
    }
}
