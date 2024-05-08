use crate::{
    composite::*,
    error::SwapLayerError,
    utils::{
        self,
        jupiter_v6::{self, cpi::SharedAccountsRouteArgs},
        AnchorInstructionData,
    },
};
use anchor_lang::prelude::*;
use anchor_spl::{associated_token, token};
use swap_layer_messages::types::{
    JupiterV6SwapParameters, OutputSwap, OutputToken, RedeemMode, SwapType,
};

#[derive(Accounts)]
pub struct CompleteSwap<'info> {
    #[account(mut)]
    payer: Signer<'info>,

    /// Prepared fill account.
    #[account(
        constraint = {
            let swap_msg = consume_swap_layer_fill.read_message_unchecked();

            require!(
                matches!(
                    swap_msg.redeem_mode,
                    RedeemMode::Direct,
                ),
                SwapLayerError::InvalidRedeemMode
            );

            require_keys_eq!(
                recipient.key(),
                Pubkey::from(swap_msg.recipient),
                SwapLayerError::InvalidRecipient
            );

            // Ensure that the output token is a swap token for Jupiter V6.
            match swap_msg.output_token {
                OutputToken::Token(OutputSwap {
                    deadline,
                    limit_amount,
                    swap_type: SwapType::JupiterV6(_),
                }) => {
                    // Check the deadline for the swap. There may not be a deadline check with the
                    // dex that this instruction composes with, so we will check it here.
                    //
                    // TODO: Do we accept deadline == 0?
                    require!(
                        deadline == 0
                            || Clock::get().unwrap().unix_timestamp <= i64::from(deadline),
                        SwapLayerError::SwapPastDeadline,
                    );

                    // Just in case the encoded limit amount exceeds u64, we have nothing to do if
                    // this message were misconfigured.
                    u64::try_from(limit_amount).map_err(|_| SwapLayerError::InvalidLimitAmount)?;

                    // Done.
                    Ok(())
                }
                _ => err!(SwapLayerError::InvalidOutputToken),
            }?;

            true
        }
    )]
    consume_swap_layer_fill: ConsumeSwapLayerFill<'info>,

    /// CHECK: Seeds must be \["swap-authority", prepared_fill.key()\].
    #[account(
        seeds = [
            crate::SWAP_AUTHORITY_SEED_PREFIX,
            consume_swap_layer_fill.key().as_ref(),
        ],
        bump,
    )]
    swap_authority: UncheckedAccount<'info>,

    /// Temporary swap token account to receive USDC from the prepared fill. This account will be
    /// closed at the end of this instruction.
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = usdc,
        associated_token::authority = swap_authority
    )]
    src_swap_token: Box<Account<'info, token::TokenAccount>>,

    /// Temporary swap token account to receive destination mint after the swap. This account will
    /// be closed at the end of this instruction.
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = dst_mint,
        associated_token::authority = swap_authority
    )]
    dst_swap_token: Box<Account<'info, token::TokenAccount>>,

    /// This account must be verified as the source mint for the swap.
    usdc: Usdc<'info>,

    /// This account must be verified as the destination mint for the swap.
    dst_mint: Account<'info, token::Mint>,

    #[account(
        mut,
        associated_token::mint = dst_mint,
        associated_token::authority = recipient
    )]
    /// Recipient associated token account. The recipient authority check
    /// is necessary to ensure that the recipient is the intended recipient
    /// of the bridged tokens. Mutable.
    recipient_token_account: Box<Account<'info, token::TokenAccount>>,

    /// CHECK: This account must be the owner of the recipient token account. The recipient token
    /// account must be encoded in the prepared fill.
    recipient: UncheckedAccount<'info>,

    associated_token_program: Program<'info, associated_token::AssociatedToken>,
    token_program: Program<'info, token::Token>,
    system_program: Program<'info, System>,
}

pub fn complete_swap<'a, 'b, 'c, 'info>(
    ctx: Context<'a, 'b, 'c, 'info, CompleteSwap<'info>>,
    ix_data: Vec<u8>,
) -> Result<()>
where
    'c: 'info,
{
    match ctx
        .accounts
        .consume_swap_layer_fill
        .read_message_unchecked()
        .output_token
    {
        OutputToken::Token(OutputSwap {
            deadline: _,
            limit_amount,
            swap_type: SwapType::JupiterV6(swap_params),
        }) => handle_complete_swap_jupiter_v6(
            ctx,
            ix_data,
            limit_amount.try_into().unwrap(),
            swap_params,
        ),
        _ => err!(SwapLayerError::InvalidOutputToken),
    }
}

pub fn handle_complete_swap_jupiter_v6<'a, 'b, 'c, 'info>(
    ctx: Context<'a, 'b, 'c, 'info, CompleteSwap<'info>>,
    ix_data: Vec<u8>,
    quoted_out_amount: u64,
    swap_params: JupiterV6SwapParameters,
) -> Result<()>
where
    'c: 'info,
{
    // Consume prepared fill.
    utils::token_router::consume_prepared_fill(
        &ctx.accounts.consume_swap_layer_fill,
        ctx.accounts.src_swap_token.to_account_info(),
        ctx.accounts.token_program.to_account_info(),
    )?;

    // Because the source swap account is an ATA, someone could create this account and sent some
    // arbitrary amount to it to disrupt the flow of this instruction. To be safe, we will reload
    // the source swap token account to grab its amount.
    ctx.accounts.src_swap_token.reload()?;

    let swap_authority = &ctx.accounts.swap_authority;
    let src_swap_token = &ctx.accounts.src_swap_token;

    {
        // Handle Jupiter V6 swap.
        let ix_data = &mut &ix_data[..];

        // Deserialize Jupiter V6 shared accounts route args.
        SharedAccountsRouteArgs::require_selector(ix_data)?;
        let mut jupiter_args = SharedAccountsRouteArgs::deserialize(ix_data)?;

        // Try taking remaining account infos as shared accounts route accounts.
        let mut cpi_account_infos = ctx.remaining_accounts;
        let CheckedSharedAccountsRoute {
            token_program,
            jupiter_v6_authority,
            transfer_authority,
            src_custody_token,
            jupiter_v6_src_custody_token,
            jupiter_v6_dst_custody_token,
            dst_custody_token,
            src_mint,
            dst_mint,
            platform_fee_none: _,
            token_2022_program,
            jupiter_v6_event_authority,
            jupiter_v6_program,
        } = CheckedSharedAccountsRoute::try_accounts(
            &jupiter_v6::JUPITER_V6_PROGRAM_ID,
            &mut cpi_account_infos,
            ix_data,
            &mut CheckedSharedAccountsRouteBumps {
                jupiter_v6_authority: Default::default(),
            },
            &mut Default::default(),
        )?;

        // Verify remaining accounts.
        let dst_swap_token = &ctx.accounts.dst_swap_token;
        {
            require_keys_eq!(
                token_program.key(),
                ctx.accounts.token_program.key(),
                ErrorCode::ConstraintTokenTokenProgram
            );
            require_keys_eq!(
                transfer_authority.key(),
                swap_authority.key(),
                SwapLayerError::InvalidSwapAuthority
            );
            require_keys_eq!(
                src_custody_token.key(),
                ctx.accounts.src_swap_token.key(),
                SwapLayerError::InvalidSourceSwapToken
            );
            require_keys_eq!(
                dst_custody_token.key(),
                dst_swap_token.key(),
                SwapLayerError::InvalidDestinationSwapToken
            );
            require_keys_eq!(
                src_mint.key(),
                common::USDC_MINT,
                SwapLayerError::InvalidSourceMint
            );
            require_keys_eq!(
                dst_mint.key(),
                Pubkey::from(swap_params.mint),
                SwapLayerError::InvalidDestinationMint
            );
            require_keys_eq!(
                dst_mint.key(),
                ctx.accounts.dst_mint.key(),
                SwapLayerError::InvalidDestinationMint
            );
        }

        // Replace the in amount with the one found in the prepared custody token account.
        msg!(
            "Overriding in_amount: {}, quoted_out_amount: {}",
            jupiter_args.in_amount,
            jupiter_args.quoted_out_amount
        );
        jupiter_args.in_amount = src_swap_token.amount;
        jupiter_args.quoted_out_amount = quoted_out_amount;

        // Peek into the head of remaining accounts. This account will be the dex program that Jupiter
        // V6 interacts with. If the swap params specify a specific dex program, we need to ensure that
        // the one passed into this instruction handler is that.
        if let Some(dex_program_id) = swap_params.dex_program_id {
            require_keys_eq!(
                cpi_account_infos[0].key(),
                Pubkey::from(dex_program_id),
                SwapLayerError::JupiterV6DexProgramMismatch
            );
        }

        // Execute swap.
        jupiter_v6::cpi::shared_accounts_route(
            CpiContext::new(
                jupiter_v6_program.to_account_info(),
                jupiter_v6::cpi::SharedAccountsRoute {
                    token_program: token_program.to_account_info(),
                    program_authority: jupiter_v6_authority.to_account_info(),
                    user_transfer_authority: swap_authority.to_account_info(),
                    source_token: src_swap_token.to_account_info(),
                    program_source_token: jupiter_v6_src_custody_token.to_account_info(),
                    program_destination_token: jupiter_v6_dst_custody_token.to_account_info(),
                    destination_account: dst_swap_token.to_account_info(),
                    source_mint: src_mint.to_account_info(),
                    destination_mint: dst_mint.to_account_info(),
                    platform_fee: Default::default(),
                    token_2022_program: token_2022_program.to_account_info().into(),
                    event_authority: jupiter_v6_event_authority.to_account_info(),
                    program: jupiter_v6_program.to_account_info(),
                },
            )
            .with_remaining_accounts(cpi_account_infos.to_vec()),
            jupiter_args,
        )?;
    }

    let prepared_fill_key = &ctx.accounts.consume_swap_layer_fill.key();
    let swap_authority_seeds = &[
        crate::SWAP_AUTHORITY_SEED_PREFIX,
        prepared_fill_key.as_ref(),
        &[ctx.bumps.swap_authority],
    ];

    // After the swap, we reload the destination token account to get the correct amount.
    ctx.accounts.dst_swap_token.reload()?;
    let dst_swap_token = &ctx.accounts.dst_swap_token;

    // Transfer destination tokens to recipient.
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::Transfer {
                from: dst_swap_token.to_account_info(),
                to: ctx.accounts.recipient_token_account.to_account_info(),
                authority: swap_authority.to_account_info(),
            },
            &[swap_authority_seeds],
        ),
        dst_swap_token.amount,
    )?;

    let payer = &ctx.accounts.payer;
    let token_program = &ctx.accounts.token_program;

    // Close the temporary token accounts.
    token::close_account(CpiContext::new_with_signer(
        token_program.to_account_info(),
        token::CloseAccount {
            account: src_swap_token.to_account_info(),
            destination: payer.to_account_info(),
            authority: swap_authority.to_account_info(),
        },
        &[swap_authority_seeds],
    ))?;
    token::close_account(CpiContext::new_with_signer(
        token_program.to_account_info(),
        token::CloseAccount {
            account: dst_swap_token.to_account_info(),
            destination: payer.to_account_info(),
            authority: swap_authority.to_account_info(),
        },
        &[swap_authority_seeds],
    ))?;

    // Done.
    Ok(())
}

////////////////////////////////////////////////////////////////////////////////////////////////////
//
//  Jupiter V6 handling.
//
////////////////////////////////////////////////////////////////////////////////////////////////////

#[derive(Accounts)]
#[instruction(args: SharedAccountsRouteArgs)]
pub struct CheckedSharedAccountsRoute<'info> {
    token_program: Program<'info, token::Token>,

    /// We can lean on Jupiter V6 CPI failing if this is not valid. But we are
    /// being extra sure about the authority. Per Jupiter's documentation, there
    /// are only 8 authorities.
    ///
    /// CHECK: Seeds must be \["authority", id\] (Jupiter V6 Program).
    #[account(
        seeds = [
            b"authority",
            &[args.authority_id],
        ],
        bump,
        seeds::program = jupiter_v6_program,
        constraint = {
            require!(
                args.authority_id <= jupiter_v6::AUTHORITY_COUNT,
                SwapLayerError::InvalidJupiterV6AuthorityId,
            );

            true
        }
    )]
    jupiter_v6_authority: UncheckedAccount<'info>,

    // Temporary
    transfer_authority: Signer<'info>,

    // TODO: Fix to be program's.
    #[account(
        mut,
        associated_token::mint = src_mint,
        associated_token::authority = transfer_authority,
    )]
    src_custody_token: Account<'info, token::TokenAccount>,

    #[account(
        mut,
        associated_token::mint = src_mint,
        associated_token::authority = jupiter_v6_authority,
    )]
    jupiter_v6_src_custody_token: Account<'info, token::TokenAccount>,

    #[account(
        mut,
        associated_token::mint = dst_mint,
        associated_token::authority = jupiter_v6_authority,
    )]
    jupiter_v6_dst_custody_token: Account<'info, token::TokenAccount>,

    // TODO: Fix to be program's.
    #[account(
        mut,
        associated_token::mint = dst_mint,
        associated_token::authority = transfer_authority,
    )]
    dst_custody_token: Account<'info, token::TokenAccount>,

    src_mint: Account<'info, token::Mint>,

    #[account(constraint = src_mint.key() != dst_mint.key() @ SwapLayerError::SameMint)]
    dst_mint: Account<'info, token::Mint>,

    /// CHECK: This is an optional account, which will be passed in as the Jupiter V6 program ID.
    #[account(address = jupiter_v6::JUPITER_V6_PROGRAM_ID)]
    platform_fee_none: UncheckedAccount<'info>,

    /// CHECK: Token 2022 program is optional.
    token_2022_program: UncheckedAccount<'info>,

    /// CHECK: Seeds must be \["__event_authority"\] (Jupiter V6 Program).
    jupiter_v6_event_authority: UncheckedAccount<'info>,

    /// CHECK: Must equal Jupiter V6 Program ID.
    #[account(address = jupiter_v6::JUPITER_V6_PROGRAM_ID)]
    jupiter_v6_program: UncheckedAccount<'info>,
}
