use crate::{
    error::SwapLayerError,
    state::{ExecutionParams, RelayParams},
};
use anchor_lang::prelude::*;

pub fn verify_relay_params(params: &RelayParams) -> Result<()> {
    require!(params.base_fee > 0, SwapLayerError::InvalidBaseFee);
    require!(
        params.native_token_price > 0,
        SwapLayerError::InvalidNativeTokenPrice
    );
    require!(
        params.gas_dropoff_margin <= crate::MAX_BPS,
        SwapLayerError::InvalidMargin
    );

    match params.execution_params {
        ExecutionParams::Evm {
            gas_price,
            gas_price_margin,
        } => {
            require!(gas_price > 0, SwapLayerError::InvalidGasPrice);
            require!(
                gas_price_margin <= crate::MAX_BPS,
                SwapLayerError::InvalidMargin
            );
        }
        ExecutionParams::None => {}
    }

    Ok(())
}
