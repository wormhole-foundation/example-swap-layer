use std::io;

use crate::wormhole_io::{Readable, Writeable};

#[cfg(feature = "anchor")]
use anchor_lang::prelude::{borsh, AnchorDeserialize, AnchorSerialize};

use super::SwapType;

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "anchor", derive(AnchorSerialize, AnchorDeserialize))]
pub enum OutputToken {
    Usdc,
    Gas(OutputSwap),
    Token(OutputSwap),
}

impl OutputToken {
    const USDC: u8 = 0;
    const GAS: u8 = 1;
    const TOKEN: u8 = 2;

    pub fn written_size(&self) -> usize {
        match self {
            Self::Usdc => 1,
            Self::Gas(swap) => swap.written_size().saturating_add(1),
            Self::Token(swap) => swap.written_size().saturating_add(1),
        }
    }
}

impl Readable for OutputToken {
    fn read<R>(reader: &mut R) -> io::Result<Self>
    where
        Self: Sized,
        R: io::Read,
    {
        match u8::read(reader)? {
            Self::USDC => Ok(Self::Usdc),
            Self::GAS => Ok(Self::Gas(Readable::read(reader)?)),
            Self::TOKEN => Ok(Self::Token(Readable::read(reader)?)),
            _ => Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Invalid OutputToken",
            )),
        }
    }
}

impl Writeable for OutputToken {
    fn write<W>(&self, writer: &mut W) -> io::Result<()>
    where
        W: io::Write,
    {
        match self {
            Self::Usdc => Self::USDC.write(writer),
            Self::Gas(swap) => {
                Self::GAS.write(writer)?;
                swap.write(writer)
            }
            Self::Token(swap) => {
                Self::TOKEN.write(writer)?;
                swap.write(writer)
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "anchor", derive(AnchorSerialize, AnchorDeserialize))]
pub struct OutputSwap {
    pub deadline: u32,
    pub limit_amount: u128,
    pub swap_type: SwapType,
}

impl OutputSwap {
    pub fn written_size(&self) -> usize {
        const FIXED: usize = 4 // deadline
        + 16 // limit_amount
        ;
        self.swap_type.written_size().saturating_add(FIXED)
    }
}

impl Readable for OutputSwap {
    fn read<R>(reader: &mut R) -> io::Result<Self>
    where
        Self: Sized,
        R: io::Read,
    {
        Ok(Self {
            deadline: Readable::read(reader)?,
            limit_amount: Readable::read(reader)?,
            swap_type: Readable::read(reader)?,
        })
    }
}

impl Writeable for OutputSwap {
    fn write<W>(&self, writer: &mut W) -> io::Result<()>
    where
        W: io::Write,
    {
        self.deadline.write(writer)?;
        self.limit_amount.write(writer)?;
        self.swap_type.write(writer)
    }
}
