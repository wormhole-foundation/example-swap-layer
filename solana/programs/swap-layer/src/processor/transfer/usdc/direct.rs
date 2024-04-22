use crate::{composite::*, error::SwapLayerError, state::Custodian};
use anchor_lang::prelude::*;
use anchor_spl::token;
use common::wormhole_io::TypePrefixedPayload;
use swap_layer_messages::messages::SwapMessageV1;
use swap_layer_messages::types::{OutputToken, RedeemMode};
use token_router::state::PreparedFill;

#[derive(Accounts)]
pub struct CompleteTransferDirect<'info> {
    #[account(mut)]
    payer: Signer<'info>,

    custodian: CheckedCustodian<'info>,

    /// CHECK: Recipient of lamports from closing the prepared_fill account.
    #[account(mut)]
    beneficiary: UncheckedAccount<'info>,

    /// CHECK: This account must be the owner of the recipient token account. The
    /// recipient token account must be encoded in the prepared fill.
    recipient: UncheckedAccount<'info>,

    #[account(
        mut,
        associated_token::mint = usdc,
        associated_token::authority = recipient
    )]
    /// Recipient associated token account. The recipient authority check
    /// is necessary to ensure that the recipient is the intended recipient
    /// of the bridged tokens. Mutable.
    pub recipient_token_account: Box<Account<'info, token::TokenAccount>>,

    usdc: Usdc<'info>,

    /// Prepared fill account.
    #[account(mut, constraint = {
        let swap_msg = SwapMessageV1::read_slice(&prepared_fill.redeemer_message)
                .map_err(|_| SwapLayerError::InvalidSwapMessage)?;

        require_keys_eq!(
            Pubkey::from(swap_msg.recipient),
            recipient.key(),
            SwapLayerError::InvalidRecipient
        );

        require!(
            matches!(
                swap_msg.output_token,
                OutputToken::Usdc
            ),
            SwapLayerError::InvalidOutputToken
        );

        true
    })]
    prepared_fill: Account<'info, PreparedFill>,

    /// Custody token account. This account will be closed at the end of this instruction. It just
    /// acts as a conduit to allow this program to be the transfer initiator in the CCTP message.
    ///
    /// CHECK: Mutable. Seeds must be \["custody"\].
    #[account(mut)]
    token_router_custody: Account<'info, token::TokenAccount>,

    token_router_program: Program<'info, token_router::program::TokenRouter>,
    token_program: Program<'info, token::Token>,
    system_program: Program<'info, System>,
}

pub fn complete_transfer_direct(ctx: Context<CompleteTransferDirect>) -> Result<()> {
    // Parse the redeemer message.
    let swap_msg = SwapMessageV1::read_slice(&ctx.accounts.prepared_fill.redeemer_message).unwrap();

    match swap_msg.redeem_mode {
        RedeemMode::Direct => handle_complete_transfer_direct(ctx),
        _ => err!(SwapLayerError::InvalidRedeemMode),
    }
}

fn handle_complete_transfer_direct(ctx: Context<CompleteTransferDirect>) -> Result<()> {
    // TODO: Add account constraint that order sender is a registered swap layer.
    // Check the order sender and from chain.

    // CPI Call token router.
    token_router::cpi::consume_prepared_fill(CpiContext::new_with_signer(
        ctx.accounts.token_router_program.to_account_info(),
        token_router::cpi::accounts::ConsumePreparedFill {
            redeemer: ctx.accounts.custodian.to_account_info(),
            beneficiary: ctx.accounts.beneficiary.to_account_info(),
            prepared_fill: ctx.accounts.prepared_fill.to_account_info(),
            dst_token: ctx.accounts.recipient_token_account.to_account_info(),
            prepared_custody_token: ctx.accounts.token_router_custody.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
        },
        &[Custodian::SIGNER_SEEDS],
    ))?;

    Ok(())
}
