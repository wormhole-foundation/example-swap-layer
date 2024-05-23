use crate::{composite::*, error::SwapLayerError};
use anchor_lang::prelude::*;
use anchor_spl::associated_token;
use swap_layer_messages::types::RedeemMode;

#[derive(Accounts)]
pub struct CompleteSwapDirect<'info> {
    complete_swap: CompleteSwap<'info>,

    #[account(
        mut,
        address = associated_token::get_associated_token_address(
            &recipient.key(),
            &complete_swap.dst_mint.key()
        )
    )]
    /// Recipient associated token account. The recipient authority check is necessary to ensure
    /// that the recipient is the intended recipient of the bridged tokens.
    ///
    /// If OutputToken::Other, this account will be deserialized to ensure that the recipient is
    /// the owner of this token account.
    ///
    /// CHECK: Mutable ATA whose owner is the recipient and mint is the destination mint.
    recipient_token: UncheckedAccount<'info>,

    /// CHECK: This account must be the owner of the recipient token account. The recipient token
    /// account must be encoded in the prepared fill.
    #[account(mut)]
    recipient: UncheckedAccount<'info>,
}

pub fn complete_swap_direct<'a, 'b, 'c, 'info>(
    ctx: Context<'a, 'b, 'c, 'info, CompleteSwapDirect<'info>>,
    instruction_data: Vec<u8>,
) -> Result<()>
where
    'c: 'info,
{
    let complete_swap_accounts = &mut ctx.accounts.complete_swap;

    // Read message to determine redeem mode and consume prepared fill.
    let swap_msg = complete_swap_accounts.read_message_unchecked();
    let in_amount = complete_swap_accounts.consume_prepared_fill()?;

    match &swap_msg.redeem_mode {
        RedeemMode::Direct => complete_swap_jup_v6(
            complete_swap_accounts,
            &ctx.bumps.complete_swap,
            ctx.remaining_accounts,
            instruction_data,
            in_amount,
            swap_msg,
            &ctx.accounts.recipient,
            &ctx.accounts.recipient_token,
            Default::default(),
        ),
        _ => err!(SwapLayerError::InvalidRedeemMode),
    }
}
