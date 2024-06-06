#[anchor_lang::error_code]
pub enum SwapLayerError {
    DummyError = 0x0,
    ExceedsCpiAccountRealloc = 0x2,
    U64Overflow = 0x4,

    // Common errors for inbound and outbound.
    InvalidTargetChain = 0x20,
    RelayerFeeOverflow = 0x30,

    AssistantZeroPubkey = 0x100,
    FeeRecipientZeroPubkey = 0x101,
    FeeUpdaterZeroPubkey = 0x102,
    InvalidRedeemMode = 0x103,
    InvalidOutputToken = 0x104,
    InvalidRelayerFee = 0x105,
    InvalidSwapMessage = 0x106,
    InvalidRecipient = 0x107,
    InvalidFeeUpdater = 0x108,
    ChainNotAllowed = 0x109,
    InvalidPeer = 0x10a,
    InvalidGasDropoff = 0x10b,
    RelayingDisabled = 0x10c,
    InvalidExecutionParams = 0x10d,
    UnsupportedExecutionParams = 0x10e,
    GasConversionOverflow = 0x10f,
    GasDropoffCalculationFailed = 0x110,
    ExceedsMaxRelayingFee = 0x111,
    InvalidPreparedOrder = 0x112,
    InvalidFeeRecipient = 0x113,
    PayloadTooLarge = 0x114,
    UnsupportedFillType = 0x115,
    SwapTimeLimitNotExceeded = 0x116,
    ImmutableProgram = 0x118,

    // EVM Execution Param errors
    InvalidBaseFee = 0x200,
    InvalidGasPrice = 0x201,
    InvalidGasTokenPrice = 0x202,
    InvalidUpdateThreshold = 0x203,
    InvalidNativeTokenPrice = 0x204,
    InvalidMargin = 0x205,
    EvmGasCalculationFailed = 0x206,

    // Staged outbound
    EitherSenderOrProgramTransferAuthority = 0x240,
    SenderTokenRequired = 0x242,
    SenderRequired = 0x244,
    RelayingFeeExceedsMinAmountOut = 0x260,
    ZeroMinAmountOut = 0x262,
    DelegatedAmountMismatch = 0x264,
    ExactInRequired = 0x266,
    InsufficientAmountIn = 0x268,

    // Swap
    SwapPastDeadline = 0x300,
    InvalidLimitAmount = 0x302,
    InvalidSwapType = 0x304,
    InsufficientAmountOut = 0x306,
    InvalidSourceResidual = 0x308,
    SourceResidualMismatch = 0x30a,

    // Jupiter V6
    #[msg("Jupiter V6 Authority ID must be >= 0 and < 8")]
    InvalidJupiterV6AuthorityId = 0x320,
    SameMint = 0x322,
    InvalidSwapAuthority = 0x330,
    InvalidSourceSwapToken = 0x332,
    InvalidDestinationSwapToken = 0x333,
    InvalidSourceMint = 0x334,
    InvalidDestinationMint = 0x335,
    NotJupiterV6DirectRoute = 0x340,
    JupiterV6DexProgramMismatch = 0x342,
    InvalidJupiterV6QuotedOutAmount = 0x344,
    SwapFailed = 0x346,
    InvalidSwapInAmount = 0x348,

    // Ownership
    NoTransferOwnershipRequest = 0x400,
    NotPendingOwner = 0x401,
    InvalidNewOwner = 0x402,
    AlreadyOwner = 0x403,
    OwnerOnly = 0x404,
    OwnerOrAssistantOnly = 0x405,
}
