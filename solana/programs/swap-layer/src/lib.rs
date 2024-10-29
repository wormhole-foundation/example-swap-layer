use anchor_lang::prelude::*;

mod processor;
use processor::*;

mod composite;

mod error;

pub mod state;

pub mod utils;

declare_id!("SwapLayer1111111111111111111111111111111111");

const CUSTODIAN_BUMP: u8 = 254;
const COMPLETE_TOKEN_SEED_PREFIX: &[u8] = b"complete";

const SWAP_AUTHORITY_SEED_PREFIX: &[u8] = b"swap-authority";
const TRANSFER_AUTHORITY_SEED_PREFIX: &[u8] = b"transfer-authority";

const PREPARED_ORDER_SEED_PREFIX: &[u8] = b"prepared-order";
const STAGED_CUSTODY_TOKEN_SEED_PREFIX: &[u8] = b"staged-custody";

const MAX_BPS: u32 = 1_000_000; // 10,000.00 bps (100%)

#[program]
pub mod swap_layer {
    use super::*;

    /// Initializes the swap layer. This instruction must be called once after
    /// the program is deployed. This instruction initializes the `Custodian`
    /// account and sets the `owner`, `fee_recipient`, `owner_assistant`, and
    /// `fee_updater` fields.
    /// fields.
    ///
    /// # Arguments
    ///
    /// * `ctx` - The context for the initialization.
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        processor::initialize(ctx)
    }

    /// Adds a peer to the swap layer. The peer is identified by the `chain` and
    /// `address` fields. The `relay_params` field is used to configure the relay
    /// parameters for the peer (i.e., the gas dropoff and relaying fee) as well
    /// as the execution parameters for the peer (i.e., chain specific execution costs).
    ///
    /// # Arguments
    ///
    /// * `ctx` - The context for adding the peer.
    /// * `args` - The arguments for adding the peer.
    pub fn add_peer(ctx: Context<AddPeer>, args: AddPeerArgs) -> Result<()> {
        processor::add_peer(ctx, args)
    }

    /// Updates a peer in the swap layer. This allows the `owner` to update
    /// the peer address and relay parameters.
    ///
    /// # Arguments
    ///
    /// * `ctx` - The context for updating the peer.
    /// * `args` - The arguments for updating the peer.
    pub fn update_peer(ctx: Context<UpdatePeer>, args: AddPeerArgs) -> Result<()> {
        processor::update_peer(ctx, args)
    }

    /// Submits an ownership transfer request.
    ///
    /// This instruction sets the `pending_owner` field in the `Custodian` account. This instruction
    /// can only be called by the `owner`. The `pending_owner` address must be valid, meaning it
    /// cannot be the zero address or the current owner.
    ///
    /// # Arguments
    ///
    /// * `ctx` - The context for submitting the ownership transfer request.
    pub fn submit_ownership_transfer_request(
        ctx: Context<SubmitOwnershipTransferRequest>,
    ) -> Result<()> {
        processor::submit_ownership_transfer_request(ctx)
    }

    /// Confirms an ownership transfer request.
    ///
    /// This instruction confirms the ownership transfer request and sets the new `owner` in the
    /// `Custodian` account. This instruction can only be called by the `pending_owner`. The
    /// `pending_owner` must be the same as the `pending_owner` in the `Custodian` account.
    ///
    /// # Arguments
    ///
    /// * `ctx` - The context for confirming the ownership transfer request.
    pub fn confirm_ownership_transfer_request(
        ctx: Context<ConfirmOwnershipTransferRequest>,
    ) -> Result<()> {
        processor::confirm_ownership_transfer_request(ctx)
    }

    /// Cancels an ownership transfer request.
    ///
    /// This instruction cancels an ownership transfer request by resetting the `pending_owner` field
    /// in the `Custodian` account. This instruction can only be called by the `owner`.
    ///
    /// # Arguments
    ///
    /// * `ctx` - The context for canceling the ownership transfer request.
    pub fn cancel_ownership_transfer_request(
        ctx: Context<CancelOwnershipTransferRequest>,
    ) -> Result<()> {
        processor::cancel_ownership_transfer_request(ctx)
    }

    /// Updates the `fee_recipient` field in the `Custodian` account.
    ///
    /// This instruction is used to update the `fee_recipient` field in the `Custodian` account. This
    /// instruction can only be called by the `owner` and `owner_assistant`. The `fee_recipient` must
    /// be a valid token account. The `fee_recipient` receives any relayer fees received by the swap layer.
    ///
    /// # Arguments
    ///
    /// * `ctx` - The context for updating the fee recipient.
    pub fn update_fee_recipient(ctx: Context<UpdateFeeRecipient>) -> Result<()> {
        processor::update_fee_recipient(ctx)
    }

    /// Updates the `owner_assistant` field in the `Custodian` account.
    ///
    /// This instruction is used to update the `owner_assistant` field in the `Custodian` account. This
    /// instruction can only be called by the `owner`.
    ///
    /// # Arguments
    ///
    /// * `ctx` - The context for updating the owner assistant.
    pub fn update_owner_assistant(ctx: Context<UpdateOwnerAssistant>) -> Result<()> {
        processor::update_owner_assistant(ctx)
    }

    /// Updates the `fee_updater` field in the `Custodian` account.
    ///
    /// # Arguments
    ///
    /// * `ctx` - The context for updating the fee updater.
    pub fn update_fee_updater(ctx: Context<UpdateFeeUpdater>) -> Result<()> {
        processor::update_fee_updater(ctx)
    }

    /// Updates the relay parameters in the swap layer.
    ///
    /// # Arguments
    ///
    /// * `ctx` - The context for updating the relay parameters.
    /// * `args` - The arguments for updating the relay parameters.
    pub fn update_relay_parameters(
        ctx: Context<UpdateRelayParameters>,
        args: UpdateRelayParametersArgs,
    ) -> Result<()> {
        processor::update_relay_parameters(ctx, args)
    }

    /// Completes a transfer with relay in the swap layer. If gas dropoff is
    /// specified, the program will transfer the requested number of lamports
    /// from the payer to the relayer. In return, the program will transfer
    /// the specified number of USDC to the `fee_recipient_token` account.
    ///
    /// # Arguments
    ///
    /// * `ctx` - The context for completing the transfer relay.
    pub fn complete_transfer_relay(ctx: Context<CompleteTransferRelay>) -> Result<()> {
        processor::complete_transfer_relay(ctx)
    }

    /// Completes a direct transfer in the swap layer.
    ///
    /// # Arguments
    ///
    /// * `ctx` - The context for completing the direct transfer.
    pub fn complete_transfer_direct(ctx: Context<CompleteTransferDirect>) -> Result<()> {
        processor::complete_transfer_direct(ctx)
    }

    /// Completes a payload transfer in the swap layer. This instruction stages
    /// the inbound transfer and creates a custody token account for the inbound
    /// transfer. The arbitrary payload is stored in the `staged_inbound` account.
    ///
    /// # Arguments
    ///
    /// * `ctx` - The context for completing the payload transfer.
    pub fn complete_transfer_payload(ctx: Context<CompleteTransferPayload>) -> Result<()> {
        processor::complete_transfer_payload(ctx)
    }

    /// Releases an inbound transfer in the swap layer. Only the encoded
    /// recipient can release the inbound transfer.
    ///
    /// # Arguments
    ///
    /// * `ctx` - The context for releasing the inbound transfer.
    pub fn release_inbound(ctx: Context<ReleaseInbound>) -> Result<()> {
        processor::release_inbound(ctx)
    }

    /// Stages an outbound transfer or swap in the swap layer.
    ///
    /// # Arguments
    ///
    /// * `ctx` - The context for staging the outbound transfer.
    /// * `args` - The arguments for staging the outbound transfer.
    pub fn stage_outbound(ctx: Context<StageOutbound>, args: StageOutboundArgs) -> Result<()> {
        processor::stage_outbound(ctx, args)
    }

    /// Closes the `staged_outbound` account in the swap layer. This should be executed
    /// when the user decides to cancel the staged outbound transfer. This could be the
    /// result of a failed swap when initiating an outbound swap.
    ///
    /// # Arguments
    ///
    /// * `ctx` - The context for closing the staged outbound.
    pub fn close_staged_outbound(ctx: Context<CloseStagedOutbound>) -> Result<()> {
        processor::close_staged_outbound(ctx)
    }

    /// Initiates a USDC transfer in the swap layer.
    ///
    /// # Arguments
    ///
    /// * `ctx` - The context for initiating the transfer.
    pub fn initiate_transfer(ctx: Context<InitiateTransfer>) -> Result<()> {
        processor::initiate_transfer(ctx)
    }

    /// Initiates a swap with exact input in the swap layer.
    ///
    /// # Arguments
    ///
    /// * `ctx` - The context for initiating the swap.
    /// * `instruction_data` - The instruction data for initiating the swap.
    pub fn initiate_swap_exact_in<'a, 'b, 'c, 'info>(
        ctx: Context<'a, 'b, 'c, 'info, InitiateSwapExactIn<'info>>,
        instruction_data: Vec<u8>,
    ) -> Result<()>
    where
        'c: 'info,
    {
        processor::initiate_swap_exact_in(ctx, instruction_data)
    }

    /// Completes a direct swap in the swap layer.
    ///
    /// # Arguments
    ///
    /// * `ctx` - The context for completing the swap.
    /// * `instruction_data` - The instruction data for completing the swap.
    pub fn complete_swap_direct<'a, 'b, 'c, 'info>(
        ctx: Context<'a, 'b, 'c, 'info, CompleteSwapDirect<'info>>,
        instruction_data: Vec<u8>,
    ) -> Result<()>
    where
        'c: 'info,
    {
        processor::complete_swap_direct(ctx, instruction_data)
    }

    /// Completes a relay swap in the swap layer. If gas dropoff is
    /// specified, the program will transfer the requested number of lamports
    /// from the payer to the relayer. In return, the program will transfer
    /// the specified number of USDC to the `fee_recipient_token` account.
    ///
    /// # Arguments
    ///
    /// * `ctx` - The context for completing the swap.
    /// * `instruction_data` - The instruction data for completing the swap.
    pub fn complete_swap_relay<'a, 'b, 'c, 'info>(
        ctx: Context<'a, 'b, 'c, 'info, CompleteSwapRelay<'info>>,
        instruction_data: Vec<u8>,
    ) -> Result<()>
    where
        'c: 'info,
    {
        processor::complete_swap_relay(ctx, instruction_data)
    }

    /// Completes a payload swap in the swap layer.
    ///
    /// # Arguments
    ///
    /// * `ctx` - The context for completing the swap.
    /// * `instruction_data` - The instruction data for completing the swap.
    pub fn complete_swap_payload<'a, 'b, 'c, 'info>(
        ctx: Context<'a, 'b, 'c, 'info, CompleteSwapPayload<'info>>,
        instruction_data: Vec<u8>,
    ) -> Result<()>
    where
        'c: 'info,
    {
        processor::complete_swap_payload(ctx, instruction_data)
    }
}
