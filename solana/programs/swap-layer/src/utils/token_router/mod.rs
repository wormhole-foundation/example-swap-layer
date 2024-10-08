use crate::{composite::*, state::Custodian};
use anchor_lang::prelude::*;

pub fn consume_prepared_fill<'info>(
    accounts: &ConsumeSwapLayerFill<'info>,
    dst_token: AccountInfo<'info>,
    token_program: AccountInfo<'info>,
) -> Result<u64> {
    let amount = accounts.fill_custody_token.amount;

    token_router::cpi::consume_prepared_fill(CpiContext::new_with_signer(
        accounts.token_router_program.to_account_info(),
        token_router::cpi::accounts::ConsumePreparedFill {
            redeemer: accounts.custodian.to_account_info(),
            beneficiary: accounts.beneficiary.to_account_info(),
            prepared_fill: accounts.fill.to_account_info(),
            dst_token,
            prepared_custody_token: accounts.fill_custody_token.to_account_info(),
            token_program,
        },
        &[Custodian::SIGNER_SEEDS],
    ))?;

    Ok(amount)
}
