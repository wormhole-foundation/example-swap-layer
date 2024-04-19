#[anchor_lang::error_code]
pub enum SwapLayerError {
    DummyError = 0x0,
    AssistantZeroPubkey = 0x100,
    FeeRecipientZeroPubkey = 0x101,
    FeeUpdaterZeroPubkey = 0x102,
    InvalidRedeemMode = 0x103,
    InvalidOutputToken = 0x104,
    InvalidRelayerFee = 0x105,
    InvalidSwapMessage = 0x106,
}
