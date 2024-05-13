use anchor_lang::prelude::*;
use common::admin;

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
    pub const SEED_PREFIX: &'static [u8] = b"custodian";
    pub const BUMP: u8 = crate::CUSTODIAN_BUMP;
    pub const SIGNER_SEEDS: &'static [&'static [u8]] = &[Self::SEED_PREFIX, &[Self::BUMP]];
}

impl admin::Ownable for Custodian {
    fn owner(&self) -> &Pubkey {
        &self.owner
    }

    fn owner_mut(&mut self) -> &mut Pubkey {
        &mut self.owner
    }
}

impl admin::PendingOwner for Custodian {
    fn pending_owner(&self) -> &Option<Pubkey> {
        &self.pending_owner
    }

    fn pending_owner_mut(&mut self) -> &mut Option<Pubkey> {
        &mut self.pending_owner
    }
}

impl admin::OwnerAssistant for Custodian {
    fn owner_assistant(&self) -> &Pubkey {
        &self.owner_assistant
    }

    fn owner_assistant_mut(&mut self) -> &mut Pubkey {
        &mut self.owner_assistant
    }
}

#[cfg(test)]
mod test {
    use solana_program::pubkey::Pubkey;

    use super::*;

    #[test]
    fn test_bump() {
        let (custodian, bump) =
            Pubkey::find_program_address(&[Custodian::SEED_PREFIX], &crate::id());
        assert_eq!(Custodian::BUMP, bump, "bump mismatch");
        assert_eq!(
            custodian,
            Pubkey::create_program_address(Custodian::SIGNER_SEEDS, &crate::id()).unwrap(),
            "custodian mismatch",
        );
    }
}
