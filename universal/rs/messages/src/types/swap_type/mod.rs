mod evm;
pub use evm::*;

mod solana;
pub use solana::*;

use std::io;

use crate::wormhole_io::{Readable, Writeable};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SwapType {
    Invalid,
    UniswapV3(UniswapSwapParameters),
    TraderJoe(TraderJoeSwapParameters),
    JupiterV6(JupiterV6SwapParameters),
}

impl SwapType {
    const UNISWAP_V3: u8 = 1;
    const TRADER_JOE: u8 = 2;
    const JUPITER_V6: u8 = 16;
}

impl Readable for SwapType {
    const SIZE: Option<usize> = None;

    fn read<R>(reader: &mut R) -> io::Result<Self>
    where
        Self: Sized,
        R: io::Read,
    {
        match u8::read(reader)? {
            Self::UNISWAP_V3 => Ok(Self::UniswapV3(Readable::read(reader)?)),
            Self::TRADER_JOE => Ok(Self::TraderJoe(Readable::read(reader)?)),
            Self::JUPITER_V6 => Ok(Self::JupiterV6(Readable::read(reader)?)),
            _ => Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Invalid SwapType",
            )),
        }
    }
}

impl Writeable for SwapType {
    fn written_size(&self) -> usize {
        match self {
            Self::Invalid => 0,
            Self::UniswapV3(parameters) => parameters.written_size(),
            Self::TraderJoe(parameters) => parameters.written_size(),
            Self::JupiterV6(parameters) => parameters.written_size(),
        }
        .saturating_add(1)
    }

    fn write<W>(&self, writer: &mut W) -> io::Result<()>
    where
        W: io::Write,
    {
        match self {
            Self::Invalid => Self::Invalid.write(writer),
            Self::UniswapV3(parameters) => {
                Self::UNISWAP_V3.write(writer)?;
                parameters.write(writer)
            }
            Self::TraderJoe(parameters) => {
                Self::TRADER_JOE.write(writer)?;
                parameters.write(writer)
            }
            Self::JupiterV6(parameters) => {
                Self::JUPITER_V6.write(writer)?;
                parameters.write(writer)
            }
        }
    }
}
