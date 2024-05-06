pub mod gas_dropoff;
pub mod jupiter_v6;
pub mod relay_parameters;
pub mod relayer_fees;

use std::fmt;

use anchor_lang::prelude::*;

#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub struct AnchorSelector(pub [u8; 8]);

impl fmt::Display for AnchorSelector {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "{}", hex::encode(self.0))
    }
}

impl From<[u8; 8]> for AnchorSelector {
    fn from(data: [u8; 8]) -> Self {
        AnchorSelector(data)
    }
}

pub trait AnchorInstructionData: AnchorDeserialize {
    fn require_selector(data: &mut &[u8]) -> Result<()>;
}
