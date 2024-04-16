use anchor_lang::prelude::*;

#[account]
#[derive(Debug, InitSpace)]
pub struct Custodian {
    /// Program's owner.
    pub owner: Pubkey,
    pub pending_owner: Option<Pubkey>,

    /// Program's assistant. Can be used to update the relayer fee and swap rate.
    pub owner_assistant: Pubkey,

    /// Program's fee updater. Can be used to update fee parameters and the like.
    pub fee_updater: Pubkey,

    /// Program's fee recipient. Receives relayer fees in USDC.
    pub fee_recipient_token: Pubkey,
}

impl Custodian {
    pub const SEED_PREFIX: &'static [u8] = b"emitter";
    pub const BUMP: u8 = crate::CUSTODIAN_BUMP;
    pub const SIGNER_SEEDS: &'static [&'static [u8]] = &[Self::SEED_PREFIX, &[Self::BUMP]];
}

// #[cfg(test)]
// mod test {
//     use solana_program::pubkey::Pubkey;

//     use super::*;

//     #[test]
//     fn test_bump() {
//         let (custodian, bump) =
//             Pubkey::find_program_address(&[Custodian::SEED_PREFIX], &crate::id());
//         assert_eq!(Custodian::BUMP, bump, "bump mismatch");
//         assert_eq!(
//             custodian,
//             Pubkey::create_program_address(Custodian::SIGNER_SEEDS, &crate::id()).unwrap(),
//             "custodian mismatch",
//         );
//     }
// }
