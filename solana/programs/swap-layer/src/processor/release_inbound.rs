use crate::state::StagedInbound;
use anchor_lang::prelude::*;
use anchor_spl::token_interface;

/// Accounts required for [consume_inbound].
#[derive(Accounts)]
pub struct ReleaseInbound<'info> {
    /// This signer must be the same one encoded in the staged transfer.
    #[account(address = staged_inbound.recipient)]
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
    staged_inbound: Account<'info, StagedInbound>,

    /// Destination token account, which the redeemer may not own. But because the redeemer is a
    /// signer and is the one encoded in the Deposit Fill message, he may have the tokens be sent
    /// to any account he chooses (this one).
    ///
    /// CHECK: This token account must already exist.
    #[account(mut)]
    dst_token: UncheckedAccount<'info>,

    /// Staged custody token account. This account will be closed at the end of this instruction.
    #[account(
        mut,
        token::mint = mint,
        address = staged_inbound.custody_token,
    )]
    staged_custody_token: InterfaceAccount<'info, token_interface::TokenAccount>,

    mint: InterfaceAccount<'info, token_interface::Mint>,

    token_program: Interface<'info, token_interface::TokenInterface>,
}

pub fn release_inbound(ctx: Context<ReleaseInbound>) -> Result<()> {
    let staged_inbound = &ctx.accounts.staged_inbound;

    let staged_inbound_signer_seeds = &[
        StagedInbound::SEED_PREFIX,
        staged_inbound.seeds.prepared_fill.as_ref(),
        &[staged_inbound.seeds.bump],
    ];

    let custody_token = &ctx.accounts.staged_custody_token;
    let token_program = &ctx.accounts.token_program;
    let mint = &ctx.accounts.mint;

    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            token_program.to_account_info(),
            token_interface::TransferChecked {
                from: custody_token.to_account_info(),
                to: ctx.accounts.dst_token.to_account_info(),
                authority: staged_inbound.to_account_info(),
                mint: mint.to_account_info(),
            },
            &[staged_inbound_signer_seeds],
        ),
        custody_token.amount,
        mint.decimals,
    )?;

    // Finally close token account.
    token_interface::close_account(CpiContext::new_with_signer(
        token_program.to_account_info(),
        token_interface::CloseAccount {
            account: custody_token.to_account_info(),
            destination: ctx.accounts.beneficiary.to_account_info(),
            authority: staged_inbound.to_account_info(),
        },
        &[staged_inbound_signer_seeds],
    ))
}
