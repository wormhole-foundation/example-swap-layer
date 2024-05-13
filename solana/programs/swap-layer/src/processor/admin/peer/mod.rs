mod add;
pub use add::*;

mod update;
pub use update::*;

use crate::utils::relay_parameters::verify_relay_params;
use crate::{error::SwapLayerError, state::Peer};
use anchor_lang::prelude::*;
use common::wormhole_cctp_solana::wormhole::SOLANA_CHAIN;

pub fn handle_add_peer(peer: &mut Account<Peer>, args: AddPeerArgs) -> Result<()> {
    require!(
        args.chain != 0 && args.chain != SOLANA_CHAIN,
        SwapLayerError::ChainNotAllowed
    );
    require!(args.address != [0; 32], SwapLayerError::InvalidPeer);

    // Verify the relay parameters.
    verify_relay_params(&args.relay_params)?;

    peer.chain = args.chain;
    peer.address = args.address;
    peer.relay_params = args.relay_params;

    Ok(())
}
