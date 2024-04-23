mod add;
pub use add::*;

use crate::{
    error::SwapLayerError,
    state::{ExecutionParams, RelayParams},
};
use anchor_lang::prelude::*;

pub fn validate_relay_params(relay_params: &RelayParams) -> Result<()> {
    match relay_params.execution_params {
        ExecutionParams::None => {}
        ExecutionParams::Evm {
            gas_price,
            gas_token_price,
            update_threshold,
        } => {
            require!(gas_price > 0, SwapLayerError::InvalidGasPrice);
            require!(gas_token_price > 0, SwapLayerError::InvalidGasTokenPrice);
            require!(update_threshold > 0, SwapLayerError::InvalidUpdateThreshold);
        }
    }

    Ok(())
}
