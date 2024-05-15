use crate::state::StagedTransfer;
use anchor_lang::prelude::*;
use anchor_spl::token;

/// Accounts required for [consume_prepared_fill].
#[derive(Accounts)]
pub struct ConsumeStagedTransfer<'info> {
    /// This signer must be the same one encoded in the staged transfer.
    #[account(address = staged_transfer.recipient)]
    recipient: Signer<'info>,

    /// CHECK: This recipient may not necessarily be the same one encoded in the staged transfer (as
    /// the payer). If someone were to stage a transfer via a stage transfer ix and he had no
    /// intention of consuming it, he will be out of luck. We will reward the redeemer with the
    /// closed account funds with a payer of his choosing.
    #[account(mut)]
    beneficiary: UncheckedAccount<'info>,

    #[account(
        mut,
        close = beneficiary,
    )]
    staged_transfer: Account<'info, StagedTransfer>,

    /// Destination token account, which the redeemer may not own. But because the redeemer is a
    /// signer and is the one encoded in the Deposit Fill message, he may have the tokens be sent
    /// to any account he chooses (this one).
    ///
    /// CHECK: This token account must already exist.
    #[account(mut)]
    dst_token: UncheckedAccount<'info>,

    /// Staged custody token account. This account will be closed at the end of this instruction.
    ///
    /// CHECK: Mutable. Seeds must be \["staged-custody-token"\].
    #[account(
        mut,
        seeds = [
            crate::STAGED_CUSTODY_TOKEN_SEED_PREFIX,
            staged_transfer.key().as_ref(),
        ],
        bump = staged_transfer.staged_custody_token_bump,
    )]
    staged_custody_token: Account<'info, token::TokenAccount>,

    token_program: Program<'info, token::Token>,
}

pub fn consume_staged_transfer(ctx: Context<ConsumeStagedTransfer>) -> Result<()> {
    let staged_transfer = &ctx.accounts.staged_transfer;

    let staged_transfer_signer_seeds = &[
        StagedTransfer::SEED_PREFIX,
        staged_transfer.seeds.prepared_fill.as_ref(),
        &[staged_transfer.seeds.bump],
    ];

    let custody_token = &ctx.accounts.staged_custody_token;
    let token_program = &ctx.accounts.token_program;

    token::transfer(
        CpiContext::new_with_signer(
            token_program.to_account_info(),
            token::Transfer {
                from: custody_token.to_account_info(),
                to: ctx.accounts.dst_token.to_account_info(),
                authority: staged_transfer.to_account_info(),
            },
            &[staged_transfer_signer_seeds],
        ),
        custody_token.amount,
    )?;

    // Finally close token account.
    token::close_account(CpiContext::new_with_signer(
        token_program.to_account_info(),
        token::CloseAccount {
            account: custody_token.to_account_info(),
            destination: ctx.accounts.beneficiary.to_account_info(),
            authority: staged_transfer.to_account_info(),
        },
        &[staged_transfer_signer_seeds],
    ))
}
