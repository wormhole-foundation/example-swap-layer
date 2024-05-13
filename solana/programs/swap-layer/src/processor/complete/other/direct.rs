use crate::{
    composite::*,
    error::SwapLayerError,
    utils::{
        jupiter_v6::{self, cpi::SharedAccountsRouteArgs},
        AnchorInstructionData,
    },
};
use anchor_lang::prelude::*;
use anchor_spl::token;
use swap_layer_messages::{
    messages::SwapMessageV1,
    types::{JupiterV6SwapParameters, OutputSwap, OutputToken, RedeemMode, SwapType},
};

#[derive(Accounts)]
pub struct CompleteSwapDirect<'info> {
    #[account(
        constraint = {
            require_keys_eq!(
                complete_swap.src_mint.key(),
                common::USDC_MINT,
                SwapLayerError::InvalidSourceMint
            );

            true
        }
    )]
    complete_swap: CompleteSwap<'info>,

    #[account(
        mut,
        associated_token::mint = complete_swap.dst_mint,
        associated_token::authority = recipient
    )]
    /// Recipient associated token account. The recipient authority check
    /// is necessary to ensure that the recipient is the intended recipient
    /// of the bridged tokens. Mutable.
    recipient_token: Box<Account<'info, token::TokenAccount>>,

    /// CHECK: This account must be the owner of the recipient token account. The recipient token
    /// account must be encoded in the prepared fill.
    recipient: UncheckedAccount<'info>,
}

pub fn complete_swap_direct<'a, 'b, 'c, 'info>(
    ctx: Context<'a, 'b, 'c, 'info, CompleteSwapDirect<'info>>,
    ix_data: Vec<u8>,
) -> Result<()>
where
    'c: 'info,
{
    let SwapMessageV1 {
        recipient,
        redeem_mode,
        output_token,
    } = ctx.accounts.complete_swap.read_message_unchecked();

    require_keys_eq!(
        ctx.accounts.recipient.key(),
        Pubkey::from(recipient),
        SwapLayerError::InvalidRecipient
    );

    match redeem_mode {
        RedeemMode::Direct => match output_token {
            OutputToken::Other {
                address: _,
                swap:
                    OutputSwap {
                        deadline: _,
                        limit_amount,
                        swap_type: SwapType::JupiterV6(swap_params),
                    },
            } => handle_complete_swap_direct_jupiter_v6(
                ctx,
                ix_data,
                limit_amount.try_into().unwrap(),
                swap_params,
            ),
            _ => err!(SwapLayerError::InvalidOutputToken),
        },
        _ => err!(SwapLayerError::InvalidRedeemMode),
    }
}

pub fn handle_complete_swap_direct_jupiter_v6<'a, 'b, 'c, 'info>(
    ctx: Context<'a, 'b, 'c, 'info, CompleteSwapDirect<'info>>,
    ix_data: Vec<u8>,
    limit_amount: u64,
    swap_params: JupiterV6SwapParameters,
) -> Result<()>
where
    'c: 'info,
{
    // Consume prepared fill.
    let in_amount = ctx.accounts.complete_swap.consume_prepared_fill()?;

    let swap_authority = &ctx.accounts.complete_swap.authority;
    let src_swap_token = &ctx.accounts.complete_swap.src_swap_token;

    let prepared_fill_key = &ctx.accounts.complete_swap.prepared_fill_key();
    let swap_authority_seeds = &[
        crate::SWAP_AUTHORITY_SEED_PREFIX,
        prepared_fill_key.as_ref(),
        &[ctx.bumps.complete_swap.authority],
    ];

    {
        // Handle Jupiter V6 swap.
        let ix_data = &mut &ix_data[..];

        // Peel off the instruction selector and check that it matches what we expect.
        SharedAccountsRouteArgs::require_selector(ix_data)?;

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

        // Deserialize Jupiter V6 shared accounts route args.
        let mut jupiter_args = SharedAccountsRouteArgs::deserialize(ix_data)?;

        // Verify remaining accounts.
        let dst_swap_token = &ctx.accounts.complete_swap.dst_swap_token;
        {
            require_keys_eq!(
                transfer_authority.key(),
                swap_authority.key(),
                SwapLayerError::InvalidSwapAuthority
            );
            require_keys_eq!(
                src_custody_token.key(),
                src_swap_token.key(),
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
                ctx.accounts.complete_swap.dst_mint.key(),
                SwapLayerError::InvalidDestinationMint
            );
        }

        // Replace the in amount with the one found in the prepared custody token account.
        msg!(
            "Override in_amount: {}, quoted_out_amount: {}, slippage: {}",
            jupiter_args.in_amount,
            jupiter_args.quoted_out_amount,
            jupiter_args.slippage_bps
        );
        jupiter_args.in_amount = in_amount;

        // This is perverse, but we are performing a balance check after the swap to see if we get
        // the desired amount. If we don't, revert.
        jupiter_args.quoted_out_amount = limit_amount;

        // Configure 100% slippage (yikes).
        jupiter_args.slippage_bps = 10000;

        // Peek into the head of remaining accounts. This account will be the dex program that Jupiter
        // V6 interacts with. If the swap params specify a specific dex program, we need to ensure that
        // the one passed into this instruction handler is that.
        if let Some(dex_program_id) = swap_params.dex_program_id {
            require_eq!(
                jupiter_args.route_plan.len(),
                1,
                SwapLayerError::NotJupiterV6DirectRoute
            );
            require_keys_eq!(
                cpi_account_infos[0].key(),
                Pubkey::from(dex_program_id),
                SwapLayerError::JupiterV6DexProgramMismatch
            );
        }

        // Execute swap.
        jupiter_v6::cpi::shared_accounts_route(
            CpiContext::new_with_signer(
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
                &[swap_authority_seeds],
            )
            .with_remaining_accounts(cpi_account_infos.to_vec()),
            jupiter_args,
        )?;
    }

    // After the swap, we reload the destination token account to get the correct amount.
    ctx.accounts.complete_swap.dst_swap_token.reload()?;
    let dst_swap_token = &ctx.accounts.complete_swap.dst_swap_token;

    // Rarely do I use the gte macro, but this is a good use case for it. I want to display the
    // amounts if the limit amount is not met.
    require_gte!(
        dst_swap_token.amount,
        limit_amount,
        SwapLayerError::SwapFailed
    );

    // Transfer destination tokens to recipient.
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.complete_swap.token_program.to_account_info(),
            token::Transfer {
                from: dst_swap_token.to_account_info(),
                to: ctx.accounts.recipient_token.to_account_info(),
                authority: swap_authority.to_account_info(),
            },
            &[swap_authority_seeds],
        ),
        dst_swap_token.amount,
    )?;

    ctx.accounts
        .complete_swap
        .close_swap_accounts(&ctx.bumps.complete_swap)
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

    /// CHECK: This account will be the Swap Layer's swap authority.
    transfer_authority: UncheckedAccount<'info>,

    /// CHECK: This account will be the Swap Layer's source token account.
    #[account(mut)]
    src_custody_token: UncheckedAccount<'info>,

    #[account(
        mut,
        associated_token::mint = src_mint,
        associated_token::authority = jupiter_v6_authority,
    )]
    jupiter_v6_src_custody_token: Box<Account<'info, token::TokenAccount>>,

    #[account(
        mut,
        associated_token::mint = dst_mint,
        associated_token::authority = jupiter_v6_authority,
    )]
    jupiter_v6_dst_custody_token: Box<Account<'info, token::TokenAccount>>,

    /// CHECK: This account will be the Swap Layer's destination token account.
    #[account(mut)]
    dst_custody_token: UncheckedAccount<'info>,

    /// CHECK: This account must be the source mint for the swap.
    src_mint: UncheckedAccount<'info>,

    /// CHECK: This account must be the destination mint for the swap.
    dst_mint: UncheckedAccount<'info>,

    /// CHECK: This is an optional account, which we will enforce to be None (so it will be passed
    /// in as the Jupiter V6 program ID) because Swap Layer will not collect platform fees.
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
