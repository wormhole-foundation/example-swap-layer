pub fn denormalize_gas_dropoff(gas_dropoff: u32) -> u64 {
    u64::from(gas_dropoff).saturating_mul(crate::GAS_DROPOFF_SCALAR.into())
}
