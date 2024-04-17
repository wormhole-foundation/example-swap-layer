#[anchor_lang::error_code]
pub enum SwapLayerError {
    DummyError = 0x0,
    AssistantZeroPubkey = 0x100,
    FeeRecipientZeroPubkey = 0x101,
    FeeUpdaterZeroPubkey = 0x102,
}
