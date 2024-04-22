use crate::{composite::*, error::SwapLayerError, state::Peer};
use anchor_lang::prelude::*;
use common::wormhole_cctp_solana::wormhole::SOLANA_CHAIN;

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
}

pub fn add_peer(ctx: Context<AddPeer>, args: AddPeerArgs) -> Result<()> {
    require!(
        args.chain != 0 && args.chain != SOLANA_CHAIN,
        SwapLayerError::ChainNotAllowed
    );

    require!(args.address != [0; 32], SwapLayerError::InvalidPeer);

    ctx.accounts.peer.set_inner(Peer {
        chain: args.chain,
        address: args.address,
    });

    Ok(())
}
