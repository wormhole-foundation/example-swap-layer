use crate::utils::gas_dropoff::denormalize_gas_dropoff;
use crate::{
    composite::*,
    error::SwapLayerError,
    state::{Custodian, Peer},
};
use anchor_lang::prelude::*;
use anchor_spl::token;
use swap_layer_messages::{
    messages::SwapMessageV1,
    types::{OutputToken, RedeemMode},
    wormhole_io::TypePrefixedPayload,
};
use token_router::state::PreparedFill;

#[derive(Accounts)]
pub struct CompleteTransferRelay<'info> {
    #[account(mut)]
    /// The payer of the transaction. This could either be the recipient or a relayer.
    payer: Signer<'info>,

    custodian: CheckedCustodian<'info>,

    /// CHECK: Recipient of lamports from closing the prepared_fill account.
    #[account(mut)]
    beneficiary: UncheckedAccount<'info>,

    #[account(
        init,
        payer = payer,
        seeds = [
            crate::SEED_PREFIX_COMPLETE,
            prepared_fill.key().as_ref(),
        ],
        bump,
        token::mint = usdc,
        token::authority = custodian
    )]
    pub complete_token_account: Account<'info, token::TokenAccount>,

    #[account(mut)]
    /// CHECK: recipient may differ from payer if a relayer paid for this
    /// transaction. This instruction verifies that the recipient key
    /// passed in this context matches the intended recipient in the fill.
    pub recipient: AccountInfo<'info>,

    #[account(
        mut,
        associated_token::mint = usdc,
        associated_token::authority = recipient
    )]
    /// Recipient associated token account. The recipient authority check
    /// is necessary to ensure that the recipient is the intended recipient
    /// of the bridged tokens.
    pub recipient_token_account: Box<Account<'info, token::TokenAccount>>,

    #[account(
        mut,
        constraint = {
            require!(
                custodian.fee_recipient_token.key() == fee_recipient_token.key(),
                SwapLayerError::InvalidFeeRecipient
            );

            true
        }
    )]
    pub fee_recipient_token: Account<'info, token::TokenAccount>,

    usdc: Usdc<'info>,

    #[account(
        seeds = [
            Peer::SEED_PREFIX,
            &prepared_fill.source_chain.to_be_bytes()
        ],
        bump,
    )]
    pub peer: Box<Account<'info, Peer>>,

    /// Prepared fill account.
    #[account(mut, constraint = {
        let swap_msg = SwapMessageV1::read_slice(&prepared_fill.redeemer_message)
                .map_err(|_| SwapLayerError::InvalidSwapMessage)?;

        require!(
            prepared_fill.order_sender == peer.address,
            SwapLayerError::InvalidPeer
        );

        require!(
            matches!(
                swap_msg.output_token,
                OutputToken::Usdc
            ),
            SwapLayerError::InvalidOutputToken
        );

        require!(
            recipient.key() == Pubkey::from(swap_msg.recipient),
            SwapLayerError::InvalidRecipient
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
    // Parse the redeemer message.
    let swap_msg = SwapMessageV1::read_slice(&ctx.accounts.prepared_fill.redeemer_message).unwrap();

    // Gas dropoff needs to be scaled by 1e3 to convert into lamports.
    match swap_msg.redeem_mode {
        RedeemMode::Relay {
            gas_dropoff,
            relaying_fee,
        } => handle_complete_transfer_relay(
            ctx,
            denormalize_gas_dropoff(gas_dropoff),
            relaying_fee.into(),
        ),
        _ => err!(SwapLayerError::InvalidRedeemMode),
    }
}

fn handle_complete_transfer_relay(
    ctx: Context<CompleteTransferRelay>,
    gas_dropoff: u64,
    relaying_fee: u64,
) -> Result<()> {
    let prepared_fill = &ctx.accounts.prepared_fill;
    let fill_amount = ctx.accounts.token_router_custody.amount;
    let token_program = &ctx.accounts.token_program;

    // CPI Call token router.
    token_router::cpi::consume_prepared_fill(CpiContext::new_with_signer(
        ctx.accounts.token_router_program.to_account_info(),
        token_router::cpi::accounts::ConsumePreparedFill {
            redeemer: ctx.accounts.custodian.to_account_info(),
            beneficiary: ctx.accounts.beneficiary.to_account_info(),
            prepared_fill: prepared_fill.to_account_info(),
            dst_token: ctx.accounts.complete_token_account.to_account_info(),
            prepared_custody_token: ctx.accounts.token_router_custody.to_account_info(),
            token_program: token_program.to_account_info(),
        },
        &[Custodian::SIGNER_SEEDS],
    ))?;

    let payer = &ctx.accounts.payer;
    let recipient = &ctx.accounts.recipient;

    // If the payer is the recipient, just transfer the tokens to the recipient.
    let user_amount = {
        if payer.key() == recipient.key() {
            fill_amount
        } else {
            if gas_dropoff > 0 {
                anchor_lang::system_program::transfer(
                    CpiContext::new(
                        ctx.accounts.system_program.to_account_info(),
                        anchor_lang::system_program::Transfer {
                            from: payer.to_account_info(),
                            to: recipient.to_account_info(),
                        },
                    ),
                    gas_dropoff,
                )?;
            }

            // Calculate the user amount.
            fill_amount
                .checked_sub(relaying_fee)
                .ok_or(SwapLayerError::InvalidRelayerFee)?
        }
    };

    // Transfer the tokens to the recipient.
    anchor_spl::token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            anchor_spl::token::Transfer {
                from: ctx.accounts.complete_token_account.to_account_info(),
                to: ctx.accounts.recipient_token_account.to_account_info(),
                authority: ctx.accounts.custodian.to_account_info(),
            },
            &[Custodian::SIGNER_SEEDS],
        ),
        user_amount,
    )?;

    // Transfer eligible USDC to the fee recipient.
    if user_amount != fill_amount {
        anchor_spl::token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                anchor_spl::token::Transfer {
                    from: ctx.accounts.complete_token_account.to_account_info(),
                    to: ctx.accounts.fee_recipient_token.to_account_info(),
                    authority: ctx.accounts.custodian.to_account_info(),
                },
                &[Custodian::SIGNER_SEEDS],
            ),
            fill_amount.checked_sub(user_amount).unwrap(),
        )?;
    }

    // Finally close token account.
    token::close_account(CpiContext::new_with_signer(
        token_program.to_account_info(),
        token::CloseAccount {
            account: ctx.accounts.complete_token_account.to_account_info(),
            destination: payer.to_account_info(),
            authority: ctx.accounts.custodian.to_account_info(),
        },
        &[Custodian::SIGNER_SEEDS],
    ))
}
