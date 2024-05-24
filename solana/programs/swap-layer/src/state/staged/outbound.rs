use crate::error::SwapLayerError;
use anchor_lang::prelude::*;
use common::wormhole_io::Readable;
use swap_layer_messages::{
    messages::SwapMessageV1,
    types::{OutputToken, RedeemMode},
};

#[derive(Debug, Clone, AnchorSerialize, AnchorDeserialize)]
pub enum RedeemOption {
    Relay {
        /// Normalized amount of gas to drop off on destination network.
        gas_dropoff: u32,

        /// Maximum fee that a relayer can charge for the transfer.
        max_relayer_fee: u64,
    },
    Payload(Vec<u8>),
}

#[derive(Debug, Default, Clone, AnchorSerialize, AnchorDeserialize)]
pub enum StagedRedeem {
    #[default]
    Direct,
    Relay {
        gas_dropoff: u32,
        relaying_fee: u64,
    },
    Payload(Vec<u8>),
}

#[derive(Debug, Clone, AnchorSerialize, AnchorDeserialize, InitSpace)]
pub struct StagedOutboundInfo {
    pub custody_token_bump: u8,

    /// One who paid the lamports to create [StagedOutbound].
    pub prepared_by: Pubkey,

    /// Sender of the swap message.
    pub sender: Pubkey,

    /// Wormhole chain ID of the target network.
    pub target_chain: u16,

    /// Intended recipient of the transfer.
    pub recipient: [u8; 32],

    /// The specified token account to refund USDC. This account is required by the Token Router
    /// program in case a fast order is reverted at the Matching Engine after it has been placed.
    pub usdc_refund_token: Pubkey,
}

#[account]
#[derive(Debug)]
pub struct StagedOutbound {
    pub info: StagedOutboundInfo,
    pub staged_redeem: StagedRedeem,
    pub encoded_output_token: Vec<u8>,
}

impl StagedOutbound {
    const BASE_SIZE: usize = 8 // DISCRIMINATOR
        + StagedOutboundInfo::INIT_SPACE
        + 1 // StagedRedeem discrimant
        + 1 // encoded_output_token === None
        ;

    pub fn try_compute_size(
        redeem_option: &Option<RedeemOption>,
        encoded_output_token: &Option<Vec<u8>>,
    ) -> Result<usize> {
        Ok(Self::BASE_SIZE
            .saturating_add(match redeem_option {
                Some(redeem) => match redeem {
                    RedeemOption::Relay { .. } => 12, // gas_dropoff + relaying_fee
                    RedeemOption::Payload(payload) => payload.len().saturating_add(4),
                },
                None => 0,
            })
            .saturating_add(match encoded_output_token {
                Some(encoded_output_token) => {
                    // First validate the encoded output token by attempting to deserialize it.
                    OutputToken::read(&mut &encoded_output_token[..])
                        .map_err(|_| error!(SwapLayerError::InvalidOutputToken))?;

                    encoded_output_token.len().saturating_add(4)
                }
                None => 5, // len + OutputToken::Usdc,
            }))
    }

    pub fn to_swap_message_v1(&mut self) -> Result<SwapMessageV1> {
        let Self {
            info,
            staged_redeem,
            encoded_output_token,
        } = self;

        let staged_redeem = std::mem::take(staged_redeem);

        Ok(SwapMessageV1 {
            recipient: info.recipient,
            redeem_mode: match staged_redeem {
                StagedRedeem::Direct => Default::default(),
                StagedRedeem::Payload(buf) => RedeemMode::Payload {
                    sender: info.sender.to_bytes(),
                    buf: buf
                        .try_into()
                        .map_err(|_| SwapLayerError::PayloadTooLarge)?,
                },
                StagedRedeem::Relay {
                    gas_dropoff,
                    relaying_fee,
                } => RedeemMode::Relay {
                    gas_dropoff,
                    relaying_fee: relaying_fee.try_into().unwrap(),
                },
            },
            output_token: Readable::read(&mut &encoded_output_token[..])
                .map_err(|_| SwapLayerError::InvalidOutputToken)?,
        })
    }
}

impl std::ops::Deref for StagedOutbound {
    type Target = StagedOutboundInfo;

    fn deref(&self) -> &Self::Target {
        &self.info
    }
}
