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
    InvalidGasDropoff = 0x10b,
    RelayingDisabled = 0x10c,
    InvalidExecutionParams = 0x10d,
    UnsupportedExecutionParams = 0x10e,
    GasConversionOverflow = 0x10f,
    GasDropoffCalculationFailed = 0x110,
    ExceedsMaxRelayingFee = 0x111,

    // EVM Execution Param errors
    InvalidBaseFee = 0x200,
    InvalidGasPrice = 0x201,
    InvalidGasTokenPrice = 0x202,
    InvalidUpdateThreshold = 0x203,
    InvalidNativeTokenPrice = 0x204,
    InvalidMargin = 0x205,
    EvmGasCalculationFailed = 0x206,

    #[msg("Jupiter V6 Authority ID must be >= 0 and < 8")]
    InvalidJupiterV6AuthorityId = 0x300,
    SameMint = 0x302,
}
