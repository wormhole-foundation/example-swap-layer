use crate::{composite::*, error::SwapLayerError};
use anchor_lang::prelude::*;
use anchor_spl::token;
use swap_layer_messages::types::{OutputToken, RedeemMode};

#[derive(Accounts)]
pub struct CompleteTransferDirect<'info> {
    #[account(
        constraint = {
            let swap_msg = consume_swap_layer_fill.read_message_unchecked();

            require_keys_eq!(
                recipient.key(),
                Pubkey::from(swap_msg.recipient),
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
        }
    )]
    consume_swap_layer_fill: ConsumeSwapLayerFill<'info>,

    #[account(
        mut,
        associated_token::mint = common::USDC_MINT,
        associated_token::authority = recipient
    )]
    /// Recipient associated token account. The recipient authority check
    /// is necessary to ensure that the recipient is the intended recipient
    /// of the bridged tokens. Mutable.
    recipient_token_account: Box<Account<'info, token::TokenAccount>>,

    /// CHECK: This account must be the owner of the recipient token account. The
    /// recipient token account must be encoded in the prepared fill.
    recipient: UncheckedAccount<'info>,

    token_program: Program<'info, token::Token>,
}

pub fn complete_transfer_direct(ctx: Context<CompleteTransferDirect>) -> Result<()> {
    match ctx
        .accounts
        .consume_swap_layer_fill
        .read_message_unchecked()
        .redeem_mode
    {
        RedeemMode::Direct => ctx
            .accounts
            .consume_swap_layer_fill
            .consume_prepared_fill(
                ctx.accounts.recipient_token_account.as_ref().as_ref(),
                &ctx.accounts.token_program,
            )
            .map(|_| ()),
        _ => err!(SwapLayerError::InvalidRedeemMode),
    }
}
