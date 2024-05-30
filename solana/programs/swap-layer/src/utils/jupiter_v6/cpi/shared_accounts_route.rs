use crate::utils::{jupiter_v6::types::RoutePlanStep, AnchorInstructionData, AnchorSelector};
use anchor_lang::prelude::*;

pub const SHARED_ACCOUNTS_ROUTE_SELECTOR: AnchorSelector =
    AnchorSelector([193, 32, 155, 51, 65, 214, 156, 129]);

/// NOTE: Currently performing CPI using a CpiContext uses an excessive amount of heap memory. So
/// this will stay just in case CPI calls via Anchor become more memory efficient.
pub struct SharedAccountsRoute<'info> {
    pub token_program: AccountInfo<'info>,
    pub program_authority: AccountInfo<'info>,
    pub user_transfer_authority: AccountInfo<'info>,
    pub source_token: AccountInfo<'info>,
    pub program_source_token: AccountInfo<'info>,
    pub program_destination_token: AccountInfo<'info>,
    pub destination_account: AccountInfo<'info>,
    pub source_mint: AccountInfo<'info>,
    pub destination_mint: AccountInfo<'info>,
    pub platform_fee: Option<AccountInfo<'info>>,
    pub token_2022_program: Option<AccountInfo<'info>>,
    pub event_authority: AccountInfo<'info>,
    pub program: AccountInfo<'info>,
}

impl<'info> ToAccountMetas for SharedAccountsRoute<'info> {
    fn to_account_metas(&self, is_signer: Option<bool>) -> Vec<AccountMeta> {
        let program_id = *self.program.key;

        vec![
            AccountMeta::new_readonly(*self.token_program.key, false),
            AccountMeta::new_readonly(*self.program_authority.key, is_signer.unwrap_or_default()),
            AccountMeta::new_readonly(*self.user_transfer_authority.key, true),
            AccountMeta::new(*self.source_token.key, false),
            AccountMeta::new(*self.program_source_token.key, false),
            AccountMeta::new(*self.program_destination_token.key, false),
            AccountMeta::new(*self.destination_account.key, false),
            AccountMeta::new_readonly(*self.source_mint.key, false),
            AccountMeta::new_readonly(*self.destination_mint.key, false),
            match self.platform_fee.as_ref() {
                Some(acc_info) => AccountMeta::new(*acc_info.key, false),
                None => AccountMeta::new_readonly(program_id, false),
            },
            AccountMeta::new_readonly(
                self.token_2022_program
                    .as_ref()
                    .map_or(program_id, |acc_info| *acc_info.key),
                false,
            ),
            AccountMeta::new_readonly(*self.event_authority.key, false),
            AccountMeta::new_readonly(program_id, false),
        ]
    }
}

impl<'info> ToAccountInfos<'info> for SharedAccountsRoute<'info> {
    fn to_account_infos(&self) -> Vec<AccountInfo<'info>> {
        let program = &self.program;

        vec![
            self.token_program.clone(),
            self.program_authority.clone(),
            self.user_transfer_authority.clone(),
            self.source_token.clone(),
            self.program_source_token.clone(),
            self.program_destination_token.clone(),
            self.destination_account.clone(),
            self.source_mint.clone(),
            self.destination_mint.clone(),
            self.platform_fee
                .as_ref()
                .map_or(program.clone(), |acc_info| acc_info.clone()),
            self.token_2022_program
                .as_ref()
                .map_or(program.clone(), |acc_info| acc_info.clone()),
            self.event_authority.clone(),
            program.clone(),
        ]
    }
}

#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone)]
pub struct SharedAccountsRouteArgs {
    pub authority_id: u8,
    pub route_plan: Vec<RoutePlanStep>,
    pub in_amount: u64,
    pub quoted_out_amount: u64,
    pub slippage_bps: u16,
    pub platform_fee_bps: u8,
}

impl AnchorInstructionData for SharedAccountsRouteArgs {
    fn require_selector(data: &mut &[u8]) -> Result<()> {
        require_eq!(
            AnchorSelector::deserialize(data)?,
            SHARED_ACCOUNTS_ROUTE_SELECTOR,
            ErrorCode::InstructionDidNotDeserialize
        );

        Ok(())
    }
}
