use crate::{composite::*, error::SwapLayerError, state::Custodian};
use anchor_lang::prelude::*;
use anchor_spl::token;
use common::wormhole_io::TypePrefixedPayload;
use swap_layer_messages::messages::SwapMessageV1;
use swap_layer_messages::types::{OutputToken, RedeemMode};
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
    pub tmp_token_account: Account<'info, token::TokenAccount>,

    #[account(
        mut,
        associated_token::mint = usdc,
        associated_token::authority = recipient
    )]
    /// Recipient associated token account. The recipient authority check
    /// is necessary to ensure that the recipient is the intended recipient
    /// of the bridged tokens. Mutable.
    pub recipient_token_account: Box<Account<'info, token::TokenAccount>>,

    #[account(mut)]
    /// CHECK: recipient may differ from payer if a relayer paid for this
    /// transaction. This instruction verifies that the recipient key
    /// passed in this context matches the intended recipient in the fill.
    pub recipient: AccountInfo<'info>,

    usdc: Usdc<'info>,

    /// CHECK: Recipient of lamports from closing the prepared_fill account.
    #[account(mut)]
    beneficiary: UncheckedAccount<'info>,

    /// Prepared fill account.
    #[account(mut, constraint = {
        let swap_msg = SwapMessageV1::read_slice(&prepared_fill.redeemer_message).unwrap();

        require!(
            matches!(
                swap_msg.redeem_mode,
                RedeemMode::Relay { .. }
            ),
            SwapLayerError::InvalidRedeemMode
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

pub fn complete_transfer_relay(ctx: Context<CompleteTransferRelay>) -> Result<()> {
    let prepared_fill = &ctx.accounts.prepared_fill;
    let fill_amount = &ctx.accounts.token_router_custody.amount;
    let token_program = &ctx.accounts.token_program;

    // TODO: Add account constraint that order sender is a registered swap layer.
    // Check the order sender and from chain.

    // CPI Call token router.
    token_router::cpi::consume_prepared_fill(CpiContext::new_with_signer(
        ctx.accounts.token_router_program.to_account_info(),
        token_router::cpi::accounts::ConsumePreparedFill {
            redeemer: ctx.accounts.custodian.to_account_info(),
            beneficiary: ctx.accounts.beneficiary.to_account_info(),
            prepared_fill: prepared_fill.to_account_info(),
            dst_token: ctx.accounts.tmp_token_account.to_account_info(),
            prepared_custody_token: ctx.accounts.token_router_custody.to_account_info(),
            token_program: token_program.to_account_info(),
        },
        &[Custodian::SIGNER_SEEDS],
    ))?;

    // Parse the redeemer message.
    let swap_msg = SwapMessageV1::read_slice(&prepared_fill.redeemer_message).unwrap();

    // At this point, we know it's a relayed USDC transfer.
    // If it's a self relay, just send the tokens to the recipient token,
    // and close the custody token account.
    // If it's a relayer, send the relayer fee to the fee recipient.
    // See if the gas drop off is > 0, and if so, transfer lamports
    // from the signer to the recipient.

    let payer = &ctx.accounts.payer;
    let recipient = &ctx.accounts.recipient;

    // If the payer is the recipient, just transfer the tokens to the recipient.
    if payer.key() == recipient.key() {
        anchor_spl::token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                anchor_spl::token::Transfer {
                    from: ctx.accounts.tmp_token_account.to_account_info(),
                    to: ctx.accounts.recipient_token_account.to_account_info(),
                    authority: ctx.accounts.custodian.to_account_info(),
                },
                &[Custodian::SIGNER_SEEDS],
            ),
            *fill_amount,
        )?;
    }

    // Finally close token account.
    token::close_account(CpiContext::new_with_signer(
        token_program.to_account_info(),
        token::CloseAccount {
            account: ctx.accounts.tmp_token_account.to_account_info(),
            destination: payer.to_account_info(),
            authority: ctx.accounts.custodian.to_account_info(),
        },
        &[Custodian::SIGNER_SEEDS],
    ))
}
