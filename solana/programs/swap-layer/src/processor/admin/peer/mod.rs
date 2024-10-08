mod add;
pub use add::*;

mod update;
pub use update::*;

use crate::{
    error::SwapLayerError,
    state::{Peer, PeerSeeds},
    utils::relay_parameters::verify_relay_params,
};
use anchor_lang::prelude::*;
use common::wormhole_cctp_solana::wormhole::SOLANA_CHAIN;

pub fn handle_add_peer(
    peer: &mut Account<Peer>,
    args: AddPeerArgs,
    bump_seed: Option<u8>,
) -> Result<()> {
    require!(
        args.chain != 0 && args.chain != SOLANA_CHAIN,
        SwapLayerError::ChainNotAllowed
    );
    require!(args.address != [0; 32], SwapLayerError::InvalidPeer);

    // Verify the relay parameters.
    verify_relay_params(&args.relay_params)?;

    let AddPeerArgs {
        chain,
        address,
        relay_params,
    } = args;

    let seeds = PeerSeeds {
        chain,
        bump: bump_seed.unwrap_or_else(|| peer.seeds.bump),
    };
    let expected = Pubkey::create_program_address(
        &[Peer::SEED_PREFIX, &seeds.chain.to_be_bytes(), &[seeds.bump]],
        &crate::id(),
    )
    .map_err(|_| ErrorCode::ConstraintSeeds)?;
    require_keys_eq!(peer.key(), expected, ErrorCode::ConstraintSeeds);

    peer.set_inner(Peer {
        seeds,
        address,
        relay_params,
    });

    Ok(())
}
