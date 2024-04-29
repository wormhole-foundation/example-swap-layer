use std::io;

use crate::wormhole_io::{Readable, Writeable};

#[cfg(feature = "anchor")]
use anchor_lang::prelude::{borsh, AnchorDeserialize, AnchorSerialize};

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "anchor", derive(AnchorSerialize, AnchorDeserialize))]
pub struct JupiterV6SwapParameters {
    // pub route_plan: Vec<JupiterV6SwapRoutePlanStep>,
    // pub in_amount: u64,
    // pub quoted_out_amount: u64,
    // pub slippage_bps: u16,
    // pub platform_fee_bps: u8,
    placeholder: [u8; 100],
}

impl Readable for JupiterV6SwapParameters {
    const SIZE: Option<usize> = Some(100);

    fn read<R>(reader: &mut R) -> io::Result<Self>
    where
        Self: Sized,
        R: io::Read,
    {
        Ok(Self {
            placeholder: Readable::read(reader)?,
        })
    }
}

impl Writeable for JupiterV6SwapParameters {
    fn written_size(&self) -> usize {
        Self::SIZE.unwrap()
    }

    fn write<W>(&self, writer: &mut W) -> io::Result<()>
    where
        W: io::Write,
    {
        self.placeholder.write(writer)
    }
}
