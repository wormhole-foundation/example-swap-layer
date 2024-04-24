use crate::{
    error::SwapLayerError,
    utils::{
        jupiter_v6::{self, cpi::SharedAccountsRouteArgs},
        AnchorInstructionData,
    },
};
use anchor_lang::prelude::*;
use anchor_spl::token;

#[derive(Accounts)]
pub struct CompleteSwap<'info> {
    #[account(mut)]
    src_token: Account<'info, token::TokenAccount>,
}

pub fn complete_swap<'a, 'b, 'c, 'info>(
    ctx: Context<'a, 'b, 'c, 'info, CompleteSwap<'info>>,
    ix_data: Vec<u8>,
) -> Result<()>
where
    'c: 'info,
{
    let ix_data = &mut &ix_data[..];

    SharedAccountsRouteArgs::require_selector(ix_data)?;
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
        token_2022_program_none: _,
        jupiter_v6_event_authority,
        jupiter_v6_program,
    } = CheckedSharedAccountsRoute::try_accounts(
        &jupiter_v6::JUPITER_V6_PROGRAM_ID,
        &mut cpi_account_infos,
        &mut &ix_data[..],
        &mut CheckedSharedAccountsRouteBumps {
            jupiter_v6_authority: Default::default(),
        },
        &mut std::collections::BTreeSet::new(),
    )?;

    // Execute swap.
    jupiter_v6::cpi::shared_accounts_route(
        CpiContext::new(
            jupiter_v6_program.to_account_info(),
            jupiter_v6::cpi::SharedAccountsRoute {
                token_program: token_program.to_account_info(),
                program_authority: jupiter_v6_authority.to_account_info(),
                user_transfer_authority: transfer_authority.to_account_info(),
                source_token: src_custody_token.to_account_info(),
                program_source_token: jupiter_v6_src_custody_token.to_account_info(),
                program_destination_token: jupiter_v6_dst_custody_token.to_account_info(),
                destination_account: dst_custody_token.to_account_info(),
                source_mint: src_mint.to_account_info(),
                destination_mint: dst_mint.to_account_info(),
                platform_fee: Default::default(),
                token_2022_program: Default::default(),
                event_authority: jupiter_v6_event_authority.to_account_info(),
                program: jupiter_v6_program.to_account_info(),
            },
        ).with_remaining_accounts(cpi_account_infos.to_vec()),
        SharedAccountsRouteArgs::deserialize(ix_data)?,
    )
}

////////////////////////////////////////////////////////////////////////////////////////////////////
//
//  Jupiter V6 handling below.
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

    /// CHECK: This is an optional account, which will be passed in as the Jupiter V6 program ID.
    #[account(address = jupiter_v6::JUPITER_V6_PROGRAM_ID)]
    token_2022_program_none: UncheckedAccount<'info>,

    /// CHECK: Seeds must be \["__event_authority"\] (Jupiter V6 Program).
    jupiter_v6_event_authority: UncheckedAccount<'info>,

    /// CHECK: Must equal Jupiter V6 Program ID.
    #[account(address = jupiter_v6::JUPITER_V6_PROGRAM_ID)]
    jupiter_v6_program: UncheckedAccount<'info>,
}
