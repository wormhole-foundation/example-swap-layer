use crate::{
    composite::*,
    error::SwapLayerError,
    state::{Custodian, Peer, StagedOutbound},
};
use anchor_lang::prelude::*;
use anchor_spl::token;
use common::wormhole_io::TypePrefixedPayload;

#[derive(Accounts)]
pub struct InitiateTransfer<'info> {
    #[account(mut)]
    payer: Signer<'info>,

    custodian: CheckedCustodian<'info>,

    /// CHECK: This account must be the one who paid to create the staged outbound account.
    #[account(
        mut,
        address = staged_outbound.info.prepared_by,
    )]
    prepared_by: UncheckedAccount<'info>,

    /// Staging for outbound transfer. This account has all of the instructions needed to initiate
    /// the transfer.
    ///
    /// This account will be closed by the end of the instruction.
    #[account(
        mut,
        close = prepared_by,
    )]
    staged_outbound: Account<'info, StagedOutbound>,

    /// This custody token account will be closed by the end of the instruction.
    #[account(
        mut,
        token::mint = common::USDC_MINT,
        seeds = [
            crate::STAGED_CUSTODY_TOKEN_SEED_PREFIX,
            staged_outbound.key().as_ref(),
        ],
        bump = staged_outbound.info.custody_token_bump,
    )]
    staged_custody_token: Account<'info, token::TokenAccount>,

    /// CHECK: This account must equal the usdc refund token encoded in the staged outbound account.
    #[account(address = staged_outbound.usdc_refund_token)]
    usdc_refund_token: UncheckedAccount<'info>,

    /// Peer used to determine whether assets are sent to a valid destination.
    #[account(
        constraint = {
            require_eq!(
                staged_outbound.info.target_chain,
                target_peer.seeds.chain,
                SwapLayerError::InvalidPeer,
            );

            true
        }
    )]
    target_peer: RegisteredPeer<'info>,

    /// CHECK: Seeds must be \["emitter"] (Token Router Program).
    token_router_custodian: UncheckedAccount<'info>,

    /// CHECK: Seeds must be \["endpoint"\, target_chain.to_be_bytes()] (Matching Engine Program).
    target_router_endpoint: UncheckedAccount<'info>,

    /// CHECK: Mutable, seeds must be \["prepared-order", staged_outbound.key()\].
    #[account(
        mut,
        seeds = [
            crate::PREPARED_ORDER_SEED_PREFIX,
            staged_outbound.key().as_ref(),
        ],
        bump,
    )]
    prepared_order: UncheckedAccount<'info>,

    /// CHECK: Mutable, seeds must be \["prepared-custody", prepared_order.key()\].
    #[account(mut)]
    prepared_custody_token: UncheckedAccount<'info>,

    usdc: Usdc<'info>,

    token_router_program: Program<'info, token_router::program::TokenRouter>,
    token_program: Program<'info, token::Token>,
    system_program: Program<'info, System>,
}

pub fn initiate_transfer(ctx: Context<InitiateTransfer>) -> Result<()> {
    let redeemer_message = ctx
        .accounts
        .staged_outbound
        .to_swap_message_v1()
        .map(|msg| msg.to_vec())?;

    let staged_outbound = &ctx.accounts.staged_outbound;
    let custody_token = &ctx.accounts.staged_custody_token;
    let token_program = &ctx.accounts.token_program;
    let custodian = &ctx.accounts.custodian;

    // Change the custody token authority from target peer to custodian.
    let peer_seeds = &ctx.accounts.target_peer.seeds;
    token::set_authority(
        CpiContext::new_with_signer(
            token_program.to_account_info(),
            token::SetAuthority {
                current_authority: ctx.accounts.target_peer.to_account_info(),
                account_or_mint: custody_token.to_account_info(),
            },
            &[&[
                Peer::SEED_PREFIX,
                &peer_seeds.chain.to_be_bytes(),
                &[peer_seeds.bump],
            ]],
        ),
        token::spl_token::instruction::AuthorityType::AccountOwner,
        custodian.key().into(),
    )?;

    // Prepare market order as custodian.
    token_router::cpi::prepare_market_order(
        CpiContext::new_with_signer(
            ctx.accounts.token_router_program.to_account_info(),
            token_router::cpi::accounts::PrepareMarketOrder {
                payer: ctx.accounts.payer.to_account_info(),
                custodian: token_router::cpi::accounts::CheckedCustodian {
                    custodian: ctx.accounts.token_router_custodian.to_account_info(),
                },
                program_transfer_authority: Default::default(),
                sender: custodian.to_account_info().into(),
                prepared_order: ctx.accounts.prepared_order.to_account_info(),
                sender_token: custody_token.to_account_info(),
                refund_token: ctx.accounts.usdc_refund_token.to_account_info(),
                prepared_custody_token: ctx.accounts.prepared_custody_token.to_account_info(),
                usdc: token_router::cpi::accounts::Usdc {
                    mint: ctx.accounts.usdc.to_account_info(),
                },
                target_router_endpoint: token_router::cpi::accounts::RegisteredEndpoint {
                    endpoint: ctx.accounts.target_router_endpoint.to_account_info(),
                },
                token_program: token_program.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
            },
            &[
                Custodian::SIGNER_SEEDS,
                &[
                    crate::PREPARED_ORDER_SEED_PREFIX,
                    staged_outbound.key().as_ref(),
                    &[ctx.bumps.prepared_order],
                ],
            ],
        ),
        token_router::PrepareMarketOrderArgs {
            amount_in: custody_token.amount,
            min_amount_out: None,
            target_chain: staged_outbound.target_chain,
            redeemer: ctx.accounts.target_peer.address,
            redeemer_message,
        },
    )?;

    // Finally close the custody token account.
    token::close_account(CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        token::CloseAccount {
            account: custody_token.to_account_info(),
            destination: ctx.accounts.payer.to_account_info(),
            authority: ctx.accounts.custodian.to_account_info(),
        },
        &[Custodian::SIGNER_SEEDS],
    ))
}
