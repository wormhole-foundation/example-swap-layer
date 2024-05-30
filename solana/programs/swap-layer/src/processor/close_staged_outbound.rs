use crate::{
    composite::*,
    state::{Peer, StagedOutbound},
};
use anchor_lang::prelude::*;
use anchor_spl::token;

#[derive(Accounts)]
pub struct CloseStagedOutbound<'info> {
    /// This signer must be the same one encoded in the prepared order.
    #[account(mut, address = staged_outbound.sender)]
    sender: Signer<'info>,

    /// Acct as the authority over the staged custody token account.
    target_peer: RegisteredPeer<'info>,

    /// CHECK: This payer must be the same one encoded in the staged outbound.
    #[account(
        mut,
        address = staged_outbound.prepared_by,
    )]
    prepared_by: UncheckedAccount<'info>,

    /// Staging for outbound transfer. This instruction closes this account.
    #[account(
        mut,
        close = prepared_by,
    )]
    staged_outbound: Account<'info, StagedOutbound>,

    /// This custody token account will be closed by the end of the instruction.
    #[account(
        mut,
        token::authority = target_peer,
        seeds = [
            crate::STAGED_CUSTODY_TOKEN_SEED_PREFIX,
            staged_outbound.key().as_ref(),
        ],
        bump = staged_outbound.info.custody_token_bump,
    )]
    staged_custody_token: Account<'info, token::TokenAccount>,

    /// CHECK: Where the refund will be sent after the staged outbound is closed. We
    /// already check that the sender is the same as the prepared_by account.
    #[account(mut)]
    sender_token: Option<UncheckedAccount<'info>>,

    token_program: Program<'info, token::Token>,
    system_program: Program<'info, System>,
}

pub fn close_staged_outbound(ctx: Context<CloseStagedOutbound>) -> Result<()> {
    let target_peer_signer_seeds = &[
        Peer::SEED_PREFIX,
        &ctx.accounts.target_peer.seeds.chain.to_be_bytes(),
        &[ctx.accounts.target_peer.seeds.bump],
    ];

    match &ctx.accounts.sender_token {
        Some(sender_token) => {
            // Transfer the custody token to the sender.
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    token::Transfer {
                        from: ctx.accounts.staged_custody_token.to_account_info(),
                        to: sender_token.to_account_info(),
                        authority: ctx.accounts.target_peer.to_account_info(),
                    },
                    &[target_peer_signer_seeds],
                ),
                ctx.accounts.staged_custody_token.amount,
            )?;

            // Finally close token account.
            token::close_account(CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                token::CloseAccount {
                    account: ctx.accounts.staged_custody_token.to_account_info(),
                    destination: ctx.accounts.prepared_by.to_account_info(),
                    authority: ctx.accounts.target_peer.to_account_info(),
                },
                &[target_peer_signer_seeds],
            ))
        }
        None => {
            let lamports =
                AsRef::<AccountInfo>::as_ref(&ctx.accounts.staged_custody_token).lamports();
            let sender = ctx.accounts.sender.to_account_info();
            let prepared_by = ctx.accounts.prepared_by.to_account_info();

            // Finally close token account.
            token::close_account(CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                token::CloseAccount {
                    account: ctx.accounts.staged_custody_token.to_account_info(),
                    destination: sender.to_account_info(),
                    authority: ctx.accounts.target_peer.to_account_info(),
                },
                &[target_peer_signer_seeds],
            ))?;

            if sender.key() != prepared_by.key() {
                // Transfer the lamports to the sender.
                anchor_lang::system_program::transfer(
                    CpiContext::new(
                        ctx.accounts.system_program.to_account_info(),
                        anchor_lang::system_program::Transfer {
                            from: sender.to_account_info(),
                            to: prepared_by,
                        },
                    ),
                    lamports.saturating_sub(ctx.accounts.staged_custody_token.amount),
                )?;
            }

            Ok(())
        }
    }
}
