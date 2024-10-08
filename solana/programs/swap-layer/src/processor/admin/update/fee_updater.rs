use crate::{composite::*, error::SwapLayerError};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct UpdateFeeUpdater<'info> {
    admin: AdminMut<'info>,

    /// New Fee Updater.
    ///
    /// CHECK: Must not be zero pubkey.
    #[account(
        constraint = {
            new_fee_updater.key() != Pubkey::default()
        } @ SwapLayerError::FeeUpdaterZeroPubkey,
    )]
    new_fee_updater: UncheckedAccount<'info>,
}

pub fn update_fee_updater(ctx: Context<UpdateFeeUpdater>) -> Result<()> {
    let custodian = &mut ctx.accounts.admin.custodian;
    custodian.fee_updater = ctx.accounts.new_fee_updater.key();

    // Done.
    Ok(())
}
