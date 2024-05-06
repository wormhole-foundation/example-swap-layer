use crate::{composite::*, state::Peer};
use anchor_lang::prelude::*;

#[derive(Accounts)]
#[instruction(args: crate::AddPeerArgs)]
pub struct UpdatePeer<'info> {
    admin: OwnerOnly<'info>,

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

pub fn update_peer(ctx: Context<UpdatePeer>, args: crate::AddPeerArgs) -> Result<()> {
    crate::handle_add_peer(&mut ctx.accounts.peer, args)
}
