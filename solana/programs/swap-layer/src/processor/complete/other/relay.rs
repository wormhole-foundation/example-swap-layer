use crate::utils::gas_dropoff;
use crate::{composite::*, error::SwapLayerError};
use anchor_lang::prelude::*;
use anchor_spl::{associated_token, token};
use swap_layer_messages::{
    messages::SwapMessageV1,
    types::{JupiterV6SwapParameters, OutputSwap, OutputToken, RedeemMode, SwapType},
};

#[derive(Accounts)]
pub struct CompleteSwapRelay<'info> {
    complete_swap: CompleteSwap<'info>,

    #[account(
        mut,
        address = associated_token::get_associated_token_address(
            &recipient.key(),
            &complete_swap.dst_mint.key()
        )
    )]
    /// Recipient associated token account. The recipient authority check is necessary to ensure
    /// that the recipient is the intended recipient of the bridged tokens.
    ///
    /// If OutputToken::Other, this account will be deserialized to ensure that the recipient is
    /// the owner of this token account.
    ///
    /// CHECK: Mutable ATA whose owner is the recipient and mint is the destination mint.
    recipient_token: UncheckedAccount<'info>,

    /// CHECK: This account must be the owner of the recipient token account. The recipient token
    /// account must be encoded in the prepared fill.
    #[account(mut)]
    recipient: UncheckedAccount<'info>,

    #[account(
        mut,
        address = complete_swap.consume_swap_layer_fill.custodian.fee_recipient_token,
    )]
    fee_recipient_token: Account<'info, token::TokenAccount>,
}

pub fn complete_swap_relay<'a, 'b, 'c, 'info>(
    ctx: Context<'a, 'b, 'c, 'info, CompleteSwapRelay<'info>>,
    instruction_data: Vec<u8>,
) -> Result<()>
where
    'c: 'info,
{
    let swap_msg = ctx.accounts.complete_swap.read_message_unchecked();

    match swap_msg.redeem_mode {
        RedeemMode::Relay {
            gas_dropoff,
            relaying_fee,
        } => handle_complete_swap_relay(
            ctx,
            instruction_data,
            swap_msg,
            gas_dropoff::denormalize_gas_dropoff(gas_dropoff),
            relaying_fee.into(),
        ),
        _ => err!(SwapLayerError::InvalidRedeemMode),
    }
}

pub fn handle_complete_swap_relay<'a, 'b, 'c, 'info>(
    ctx: Context<'a, 'b, 'c, 'info, CompleteSwapRelay<'info>>,
    instruction_data: Vec<u8>,
    swap_msg: SwapMessageV1,
    gas_dropoff: u64,
    relaying_fee: u64,
) -> Result<()>
where
    'c: 'info,
{
    let SwapMessageV1 {
        recipient: encoded_recipient,
        redeem_mode: _,
        output_token,
    } = swap_msg;

    // Consume prepared fill.
    let fill_amount = ctx.accounts.complete_swap.consume_prepared_fill()?;
    let payer = &ctx.accounts.complete_swap.payer;
    let recipient = &ctx.accounts.recipient;

    require_keys_eq!(
        recipient.key(),
        Pubkey::from(encoded_recipient),
        SwapLayerError::InvalidRecipient
    );

    // Handle the relayer fee and gas dropoff. Override the relaying fee to zero
    // if the payer is the recipient (self redemption).
    let in_amount = {
        if payer.key() == recipient.key() {
            fill_amount
        } else {
            if gas_dropoff > 0 {
                anchor_lang::system_program::transfer(
                    CpiContext::new(
                        ctx.accounts.complete_swap.system_program.to_account_info(),
                        anchor_lang::system_program::Transfer {
                            from: payer.to_account_info(),
                            to: recipient.to_account_info(),
                        },
                    ),
                    gas_dropoff,
                )?;
            }

            if relaying_fee > 0 {
                // Transfer eligible USDC to the fee recipient.
                anchor_spl::token::transfer(
                    CpiContext::new_with_signer(
                        ctx.accounts.complete_swap.token_program.to_account_info(),
                        anchor_spl::token::Transfer {
                            from: ctx.accounts.complete_swap.src_swap_token.to_account_info(),
                            to: ctx.accounts.fee_recipient_token.to_account_info(),
                            authority: ctx.accounts.complete_swap.authority.to_account_info(),
                        },
                        &[&[
                            crate::SWAP_AUTHORITY_SEED_PREFIX,
                            &ctx.accounts.complete_swap.prepared_fill_key().as_ref(),
                            &[ctx.bumps.complete_swap.authority],
                        ]],
                    ),
                    relaying_fee,
                )?;
            }

            fill_amount
                .checked_sub(relaying_fee)
                .ok_or(SwapLayerError::InvalidRelayerFee)?
        }
    };

    match output_token {
        OutputToken::Gas(OutputSwap {
            deadline: _,
            limit_amount,
            swap_type: SwapType::JupiterV6(swap_params),
        }) => handle_complete_swap_direct_jup_v6(
            ctx,
            instruction_data,
            (limit_amount.try_into().unwrap(), swap_params),
            in_amount,
            true,
        ),
        OutputToken::Other {
            address: _,
            swap:
                OutputSwap {
                    deadline: _,
                    limit_amount,
                    swap_type: SwapType::JupiterV6(swap_params),
                },
        } => handle_complete_swap_direct_jup_v6(
            ctx,
            instruction_data,
            (limit_amount.try_into().unwrap(), swap_params),
            in_amount,
            false,
        ),
        _ => err!(SwapLayerError::InvalidOutputToken),
    }
}

fn handle_complete_swap_direct_jup_v6<'a, 'b, 'c, 'info>(
    ctx: Context<'a, 'b, 'c, 'info, CompleteSwapRelay<'info>>,
    ix_data: Vec<u8>,
    limit_and_params: (u64, JupiterV6SwapParameters),
    in_amount: u64,
    is_native: bool,
) -> Result<()>
where
    'c: 'info,
{
    let swap_authority = &ctx.accounts.complete_swap.authority;

    let prepared_fill_key = &ctx.accounts.complete_swap.prepared_fill_key();
    let swap_authority_seeds = &[
        crate::SWAP_AUTHORITY_SEED_PREFIX,
        prepared_fill_key.as_ref(),
        &[ctx.bumps.complete_swap.authority],
    ];

    let (shared_accounts_route, mut swap_args, cpi_remaining_accounts) =
        JupiterV6SharedAccountsRoute::set_up(ctx.remaining_accounts, &ix_data[..])?;

    // Verify remaining accounts.
    {
        require_keys_eq!(
            shared_accounts_route.transfer_authority.key(),
            swap_authority.key(),
            SwapLayerError::InvalidSwapAuthority
        );
        require_keys_eq!(
            shared_accounts_route.src_custody_token.key(),
            ctx.accounts.complete_swap.src_swap_token.key(),
            SwapLayerError::InvalidSourceSwapToken
        );
        require_keys_eq!(
            shared_accounts_route.dst_custody_token.key(),
            ctx.accounts.complete_swap.dst_swap_token.key(),
            SwapLayerError::InvalidDestinationSwapToken
        );
        require_keys_eq!(
            shared_accounts_route.src_mint.key(),
            common::USDC_MINT,
            SwapLayerError::InvalidSourceMint
        );
        require_keys_eq!(
            shared_accounts_route.dst_mint.key(),
            ctx.accounts.complete_swap.dst_mint.key(),
            SwapLayerError::InvalidDestinationMint
        );
    }

    msg!(
        "Override in_amount: {}, quoted_out_amount: {}, slippage_bps: {}",
        swap_args.in_amount,
        swap_args.quoted_out_amount,
        swap_args.slippage_bps
    );
    swap_args.in_amount = in_amount;
    swap_args.quoted_out_amount = limit_and_params.0;
    swap_args.slippage_bps = 0;

    // Peek into the head of remaining accounts. This account will be the dex program that Jupiter
    // V6 interacts with. If the swap params specify a specific dex program, we need to ensure that
    // the one passed into this instruction handler is that.
    if let Some(dex_program_id) = limit_and_params.1.dex_program_id {
        require_eq!(
            swap_args.route_plan.len(),
            1,
            SwapLayerError::NotJupiterV6DirectRoute
        );
        require_keys_eq!(
            cpi_remaining_accounts[0].key(),
            Pubkey::from(dex_program_id),
            SwapLayerError::JupiterV6DexProgramMismatch
        );
    }

    // Execute swap.
    let amount_out = shared_accounts_route.swap_exact_in(
        swap_args,
        swap_authority_seeds,
        cpi_remaining_accounts,
        Some(limit_and_params.0),
    )?;

    let recipient = &ctx.accounts.recipient;

    // We perform a token transfer if the output token is not gas.
    if !is_native {
        // Verify that the encoded owner is the actual owner. ATAs are no different from other token
        // accounts, so anyone can set the authority of an ATA to be someone else.
        {
            let mut acc_data: &[_] = &ctx.accounts.recipient_token.data.borrow();
            let recipient_token_owner =
                token::TokenAccount::try_deserialize(&mut acc_data).map(|token| token.owner)?;
            require_keys_eq!(
                recipient_token_owner,
                recipient.key(),
                ErrorCode::ConstraintTokenOwner,
            );
        }

        // Transfer destination tokens to recipient.
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.complete_swap.token_program.to_account_info(),
                token::Transfer {
                    from: ctx.accounts.complete_swap.dst_swap_token.to_account_info(),
                    to: ctx.accounts.recipient_token.to_account_info(),
                    authority: swap_authority.to_account_info(),
                },
                &[swap_authority_seeds],
            ),
            amount_out,
        )?;
    }

    // NOTE: If the output token is gas, lamports reflecting the WSOL amount will be transferred to
    // the recipient's account.
    ctx.accounts.complete_swap.close_swap_accounts(
        &ctx.bumps.complete_swap,
        ctx.accounts.recipient.to_account_info(),
    )
}
