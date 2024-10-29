use crate::{
    composite::*,
    state::{Peer, RelayParams},
};
use anchor_lang::prelude::*;

#[derive(Accounts)]
#[instruction(args: AddPeerArgs)]
pub struct AddPeer<'info> {
    #[account(mut)]
    payer: Signer<'info>,

    admin: Admin<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + Peer::INIT_SPACE,
        seeds = [
            Peer::SEED_PREFIX,
            &args.chain.to_be_bytes()
        ],
        bump,
    )]
    peer: Account<'info, Peer>,

    system_program: Program<'info, System>,
}

#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone)]
pub struct AddPeerArgs {
    pub chain: u16,
    pub address: [u8; 32],
    pub relay_params: RelayParams,
}

pub fn add_peer(ctx: Context<AddPeer>, args: AddPeerArgs) -> Result<()> {
    crate::handle_add_peer(&mut ctx.accounts.peer, args, ctx.bumps.peer.into())
}
