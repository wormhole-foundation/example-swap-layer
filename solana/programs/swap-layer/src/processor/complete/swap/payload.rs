use crate::{
    composite::*,
    error::SwapLayerError,
    state::{StagedInbound, StagedInboundInfo, StagedInboundSeeds},
};
use anchor_lang::prelude::*;
use anchor_spl::{associated_token, token, token_interface};
use swap_layer_messages::{messages::SwapMessageV1, types::RedeemMode};

#[derive(Accounts)]
pub struct CompleteSwapPayload<'info> {
    #[account(mut)]
    payer: Signer<'info>,

    #[account(constraint = consume_swap_layer_fill.is_valid_output_swap(&dst_mint)?)]
    consume_swap_layer_fill: ConsumeSwapLayerFill<'info>,

    #[account(
        init_if_needed,
        payer = payer,
        space = StagedInbound::try_compute_size_if_needed(
            staged_inbound,
            consume_swap_layer_fill.read_message_unchecked()
        )?,
        seeds = [
            StagedInbound::SEED_PREFIX,
            consume_swap_layer_fill.prepared_fill_key().as_ref(),
        ],
        bump
    )]
    staged_inbound: Box<Account<'info, StagedInbound>>,

    /// Temporary swap token account to receive USDC from the prepared fill. This account will be
    /// closed at the end of this instruction.
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = usdc,
        associated_token::authority = staged_inbound,
        associated_token::token_program = token_program
    )]
    src_swap_token: Box<Account<'info, token::TokenAccount>>,

    /// Temporary swap token account to receive destination mint after the swap. This account will
    /// be closed at the end of this instruction.
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = dst_mint,
        associated_token::authority = staged_inbound,
        associated_token::token_program = dst_token_program
    )]
    dst_swap_token: Box<InterfaceAccount<'info, token_interface::TokenAccount>>,

    /// This account must be verified as the source mint for the swap.
    usdc: Usdc<'info>,

    /// CHECK: This account must be verified as the destination mint for the swap.
    #[account(constraint = usdc.key() != dst_mint.key() @ SwapLayerError::SameMint)]
    dst_mint: UncheckedAccount<'info>,

    token_program: Program<'info, token::Token>,
    dst_token_program: Interface<'info, token_interface::TokenInterface>,
    associated_token_program: Program<'info, associated_token::AssociatedToken>,
    system_program: Program<'info, System>,
}

pub fn complete_swap_payload<'a, 'b, 'c, 'info>(
    ctx: Context<'a, 'b, 'c, 'info, CompleteSwapPayload<'info>>,
    instruction_data: Vec<u8>,
) -> Result<()>
where
    'c: 'info,
{
    let staged_inbound = &mut ctx.accounts.staged_inbound;

    // Set the staged transfer if it hasn't been set yet.
    if staged_inbound.staged_by == Pubkey::default() {
        let in_amount = ctx.accounts.consume_swap_layer_fill.consume_prepared_fill(
            ctx.accounts.src_swap_token.as_ref().as_ref(),
            &ctx.accounts.token_program,
        )?;

        let SwapMessageV1 {
            recipient,
            redeem_mode,
            output_token,
        } = ctx
            .accounts
            .consume_swap_layer_fill
            .read_message_unchecked();

        match redeem_mode {
            RedeemMode::Payload { sender, buf } => staged_inbound.set_inner(StagedInbound {
                seeds: StagedInboundSeeds {
                    prepared_fill: ctx.accounts.consume_swap_layer_fill.prepared_fill_key(),
                    bump: ctx.bumps.staged_inbound,
                },
                info: StagedInboundInfo {
                    custody_token: ctx.accounts.dst_swap_token.key(),
                    staged_by: ctx.accounts.payer.key(),
                    source_chain: ctx.accounts.consume_swap_layer_fill.fill.source_chain,
                    sender,
                    recipient: Pubkey::from(recipient),
                    is_native: false,
                },
                recipient_payload: buf.into(),
            }),
            _ => return err!(SwapLayerError::InvalidRedeemMode),
        };

        handle_complete_swap_jup_v6(
            HandleCompleteSwap {
                payer: &ctx.accounts.payer,
                consume_swap_layer_fill: &ctx.accounts.consume_swap_layer_fill,
                authority: ctx.accounts.staged_inbound.as_ref().as_ref(),
                src_swap_token: &ctx.accounts.src_swap_token,
                dst_swap_token: &ctx.accounts.dst_swap_token,
                dst_mint: &ctx.accounts.dst_mint,
                token_program: &ctx.accounts.token_program,
                system_program: &ctx.accounts.system_program,
                dst_token_program: &ctx.accounts.dst_token_program,
            },
            StagedInbound::SEED_PREFIX,
            ctx.bumps.staged_inbound,
            ctx.remaining_accounts,
            instruction_data,
            in_amount,
            SwapMessageV1 {
                recipient,
                redeem_mode: Default::default(), // RedeemMode is not handled in this method.
                output_token,
            },
            Default::default(),
            Default::default(),
        )?;
    }

    // Done.
    Ok(())
}
