#[anchor_lang::error_code]
pub enum SwapLayerError {
    AssistantZeroPubkey = 0x100,
    FeeRecipientZeroPubkey = 0x101,
    FeeUpdaterZeroPubkey = 0x102,
}