use crate::utils::relay_parameters::verify_relay_params;
use crate::{
    composite::*,
    state::{Peer, RelayParams},
};
use anchor_lang::prelude::*;

#[derive(Accounts)]
#[instruction(args: UpdateRelayParametersArgs)]
pub struct UpdateRelayParameters<'info> {
    fee_updater: FeeUpdater<'info>,

    #[account(
        mut,
        seeds = [
            Peer::SEED_PREFIX,
            &args.chain.to_be_bytes()
        ],
        bump,
    )]
    peer: Account<'info, Peer>,
}

#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone)]
pub struct UpdateRelayParametersArgs {
    pub chain: u16,
    pub relay_params: RelayParams,
}

pub fn update_relay_parameters(
    ctx: Context<UpdateRelayParameters>,
    args: UpdateRelayParametersArgs,
) -> Result<()> {
    verify_relay_params(&args.relay_params)?;

    let peer = &mut ctx.accounts.peer;
    peer.relay_params = args.relay_params;

    Ok(())
}
