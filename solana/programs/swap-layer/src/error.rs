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
    InvalidRecipient = 0x107,
    OwnerOrAssistantOnly = 0x108,
    ChainNotAllowed = 0x109,
    InvalidPeer = 0x10a,

    // EVM Execution Param errors
    InvalidGasPrice = 0x200,
    InvalidGasTokenPrice = 0x201,
    InvalidUpdateThreshold = 0x202,

    #[msg("Jupiter V6 Authority ID must be >= 0 and < 8")]
    InvalidJupiterV6AuthorityId = 0x300,
    SameMint = 0x302,
}
