use anchor_lang::prelude::*;

#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum Side {
    Bid,
    Ask,
}

#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub struct RoutePlanStep {
    swap: Swap,
    percent: u8,
    input_index: u8,
    output_index: u8,
}

#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum Swap {
    Saber,
    SaberAddDecimalsDeposit,
    SaberAddDecimalsWithdraw,
    TokenSwap,
    Sencha,
    Step,
    Cropper,
    Raydium,
    Crema {
        a_to_b: bool,
    },
    Lifinity,
    Mercurial,
    Cykura,
    Serum {
        side: Side,
    },
    MarinadeDeposit,
    MarinadeUnstake,
    Aldrin {
        side: Side,
    },
    AldrinV2 {
        side: Side,
    },
    Whirlpool {
        a_to_b: bool,
    },
    Invariant {
        x_to_y: bool,
    },
    Meteora,
    GooseFX,
    DeltaFi {
        stable: bool,
    },
    Balansol,
    MarcoPolo {
        x_to_y: bool,
    },
    Dradex {
        side: Side,
    },
    LifinityV2,
    RaydiumClmm,
    Openbook {
        side: Side,
    },
    Phoenix {
        side: Side,
    },
    Symmetry {
        from_token_id: u64,
        to_token_id: u64,
    },
    TokenSwapV2,
    HeliumTreasuryManagementRedeemV0,
    StakeDexStakeWrappedSol,
    StakeDexSwapViaStake {
        bridge_stake_seed: u32,
    },
    GooseFXV2,
    Perps,
    PerpsAddLiquidity,
    PerpsRemoveLiquidity,
    MeteoraDlmm,
    OpenbookV2 {
        side: Side,
    },
    RaydiumClmmV2,
    StakeDexPrefundWithdrawStakeAndDepositStake {
        bridge_stake_seed: u32,
    },
}

#[derive(Debug, Clone)]
pub struct JupiterV6;

impl Id for JupiterV6 {
    fn id() -> Pubkey {
        solana_program::pubkey!("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4")
    }
}
