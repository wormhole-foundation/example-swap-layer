use crate::{composite::*, state::Custodian, error::SwapLayerError};
use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};
use common::wormhole_io::TypePrefixedPayload;
use swap_layer_messages::messages::SwapMessageV1;
use swap_layer_messages::types::{RedeemMode, OutputToken};
use token_router::state::PreparedFill;

#[derive(Accounts)]
pub struct CompleteTransferRelay<'info> {
    #[account(mut)]
    /// The payer of the transaction. This could either be the recipient or a relayer.
    payer: Signer<'info>,

    custodian: CheckedCustodian<'info>,

    #[account(
        init,
        payer = payer,
        seeds = [
            crate::SEED_PREFIX_TMP,
            usdc.key().as_ref(),
        ],
        bump,
        token::mint = usdc,
        token::authority = custodian
    )]
    pub tmp_token_account: Account<'info, TokenAccount>,

    // #[account(
    //     mut,
    //     associated_token::mint = usdc,
    //     associated_token::authority = recipient
    // )]
    // /// Recipient associated token account. The recipient authority check
    // /// is necessary to ensure that the recipient is the intended recipient
    // /// of the bridged tokens. Mutable.
    // pub recipient_token_account: Box<Account<'info, TokenAccount>>,

    // #[account(mut)]
    // /// CHECK: recipient may differ from payer if a relayer paid for this
    // /// transaction. This instruction verifies that the recipient key
    // /// passed in this context matches the intended recipient in the fill.
    // pub recipient: AccountInfo<'info>,
    usdc: Usdc<'info>,

    /// CHECK: Recipient of lamports from closing the prepared_fill account.
    #[account(mut)]
    beneficiary: UncheckedAccount<'info>,

    /// Prepared fill account.
    #[account(mut)]
    prepared_fill: Account<'info, PreparedFill>,

    /// Custody token account. This account will be closed at the end of this instruction. It just
    /// acts as a conduit to allow this program to be the transfer initiator in the CCTP message.
    ///
    /// CHECK: Mutable. Seeds must be \["custody"\].
    #[account(mut)]
    token_router_custody: UncheckedAccount<'info>,

    token_router_program: Program<'info, token_router::program::TokenRouter>,
    token_program: Program<'info, Token>,
    system_program: Program<'info, System>,
}

pub fn complete_transfer_relay(ctx: Context<CompleteTransferRelay>) -> Result<()> {
    let prepared_fill = &ctx.accounts.prepared_fill;

    // TODO: Add account constraint that order sender is a registered swap layer.

    // CPI Call token router.
    token_router::cpi::consume_prepared_fill(CpiContext::new_with_signer(
        ctx.accounts.token_router_program.to_account_info(),
        token_router::cpi::accounts::ConsumePreparedFill {
            redeemer: ctx.accounts.custodian.to_account_info(),
            beneficiary: ctx.accounts.beneficiary.to_account_info(),
            prepared_fill: prepared_fill.to_account_info(),
            dst_token: ctx.accounts.tmp_token_account.to_account_info(),
            prepared_custody_token: ctx.accounts.token_router_custody.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
        },
        &[Custodian::SIGNER_SEEDS],
    ))?;

    // Parse the redeemer message.
    let swap_msg = SwapMessageV1::read_slice(&prepared_fill.redeemer_message).unwrap();

    match swap_msg.redeem_mode {
        RedeemMode::Relay { gas_dropoff, relaying_fee } => {
            match swap_msg.output_token {
                OutputToken::Usdc => {
                    
                }
                _ => return Err(SwapLayerError::InvalidOutputToken.into()),
            }
        }
        _ => return Err(SwapLayerError::InvalidRedeemMode.into()),
    }

    Ok(())
}
