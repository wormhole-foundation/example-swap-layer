use crate::utils::gas_dropoff::denormalize_gas_dropoff;
use crate::utils::relayer_fees::calculate_relayer_fee;
use crate::{composite::*, error::SwapLayerError, state::Peer};
use anchor_lang::prelude::borsh::{BorshDeserialize, BorshSerialize};
use anchor_lang::prelude::*;
use anchor_spl::token;
use swap_layer_messages::messages::SwapMessageV1;
use swap_layer_messages::types::{OutputToken, RedeemMode, SwapType, Uint48};

#[derive(Accounts)]
#[instruction(args: InitiateTransferArgs)]
pub struct InitiateTransfer<'info> {
    #[account(mut)]
    /// The payer of the transaction. This could either be the recipient or a relayer.
    payer: Signer<'info>,

    #[account(
        mut,
        associated_token::mint = usdc,
        associated_token::authority = payer
    )]
    payer_token_account: Box<Account<'info, token::TokenAccount>>,

    usdc: Usdc<'info>,

    #[account(
        seeds = [
            Peer::SEED_PREFIX,
            &args.target_chain.to_be_bytes(),
        ],
        bump,
    )]
    peer: Box<Account<'info, Peer>>,

    /// CHECK: Token router config.
    token_router_custodian: UncheckedAccount<'info>,

    /// CHECK:
    transfer_authority: UncheckedAccount<'info>,

    #[account(mut)]
    /// CHECK:
    prepared_order: UncheckedAccount<'info>,

    #[account(mut)]
    /// CHECK:
    prepared_custody_token: UncheckedAccount<'info>,

    token_router_program: Program<'info, token_router::program::TokenRouter>,
    token_program: Program<'info, token::Token>,
    system_program: Program<'info, System>,
}

#[derive(Debug, Clone, BorshDeserialize, BorshSerialize)]
pub struct RelayOptions {
    pub gas_dropoff: u32,
    pub max_relayer_fee: u64,
}

/// Arguments for [prepare_market_order].
#[derive(Debug, Clone, BorshDeserialize, BorshSerialize)]
pub struct InitiateTransferArgs {
    /// Amount of tokens to transfer.
    pub amount_in: u64,

    /// The Wormhole chain ID of the network to transfer tokens to.
    pub target_chain: u16,

    pub relay_options: Option<RelayOptions>,

    pub recipient: [u8; 32],
}

pub fn initiate_transfer(ctx: Context<InitiateTransfer>, args: InitiateTransferArgs) -> Result<()> {
    let mut transfer_amount = args.amount_in;

    let swap_message = if args.relay_options.is_some() {
        let relay_options = args.relay_options.unwrap();

        // Check the computed relaying fee vs. the max relaying fee.
        let relaying_fee = calculate_relayer_fee(
            &ctx.accounts.peer.relay_params,
            denormalize_gas_dropoff(relay_options.gas_dropoff),
            &SwapType::Invalid,
            0, // Swap count.
        )?;
        require!(
            relaying_fee <= relay_options.max_relayer_fee,
            SwapLayerError::ExceedsMaxRelayingFee
        );

        transfer_amount += relaying_fee;

        SwapMessageV1 {
            recipient: args.recipient,
            redeem_mode: RedeemMode::Relay {
                gas_dropoff: relay_options.gas_dropoff,
                relaying_fee: Uint48::try_from(relaying_fee).unwrap(),
            },
            output_token: OutputToken::Usdc,
        }
    } else {
        SwapMessageV1 {
            recipient: args.recipient,
            redeem_mode: RedeemMode::Direct,
            output_token: OutputToken::Usdc,
        }
    };

    token_router::cpi::prepare_market_order(
        CpiContext::new(
            ctx.accounts.token_router_program.to_account_info(),
            token_router::cpi::accounts::PrepareMarketOrder {
                payer: ctx.accounts.payer.to_account_info(),
                custodian: token_router::cpi::accounts::CheckedCustodian {
                    custodian: ctx.accounts.token_router_custodian.to_account_info(),
                },
                transfer_authority: ctx.accounts.transfer_authority.to_account_info(),
                prepared_order: ctx.accounts.prepared_order.to_account_info(),
                sender_token: ctx.accounts.payer_token_account.to_account_info(),
                refund_token: ctx.accounts.payer_token_account.to_account_info(),
                prepared_custody_token: ctx.accounts.prepared_custody_token.to_account_info(),
                usdc: token_router::cpi::accounts::Usdc {
                    mint: ctx.accounts.usdc.to_account_info(),
                },
                token_program: ctx.accounts.token_program.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
            },
        ),
        token_router::PrepareMarketOrderArgs {
            amount_in: transfer_amount,
            min_amount_out: None,
            target_chain: args.target_chain,
            redeemer: ctx.accounts.peer.address,
            redeemer_message: swap_message.try_to_vec().unwrap(),
        },
    );

    Ok(())
}
