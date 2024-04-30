use anchor_lang::prelude::*;

mod processor;
use processor::*;

mod composite;

mod error;

pub mod state;

pub mod utils;

declare_id!("AQFz751pSuxMX6PFWx9uruoVSZ3qay2Zi33MJ4NmUF2m");

const CUSTODIAN_BUMP: u8 = 255;
const SEED_PREFIX_COMPLETE: &[u8] = b"complete";
const MAX_BPS: u32 = 1_000_000; // 10,000.00 bps (100%)

#[program]
pub mod swap_layer {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        processor::initialize(ctx)
    }

    pub fn add_peer(ctx: Context<AddPeer>, args: AddPeerArgs) -> Result<()> {
        processor::add_peer(ctx, args)
    }

    pub fn complete_transfer_relay(ctx: Context<CompleteTransferRelay>) -> Result<()> {
        processor::complete_transfer_relay(ctx)
    }

    pub fn complete_transfer_direct(ctx: Context<CompleteTransferDirect>) -> Result<()> {
        processor::complete_transfer_direct(ctx)
    }

    pub fn initiate_transfer(
        ctx: Context<InitiateTransfer>,
        args: InitiateTransferArgs,
    ) -> Result<()> {
        processor::initiate_transfer(ctx, args)
    }

    pub fn complete_swap<'a, 'b, 'c, 'info>(
        ctx: Context<'a, 'b, 'c, 'info, CompleteSwap<'info>>,
        ix_data: Vec<u8>,
    ) -> Result<()>
    where
        'c: 'info,
    {
        processor::complete_swap(ctx, ix_data)
    }
}
