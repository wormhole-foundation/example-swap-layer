use std::io;

use crate::types::Uint24;
use common::wormhole_io::{Readable, Writeable};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SharedUniswapTraderJoeSwapParameters {
    pub leg_first_fee: Uint24,
    pub path: Vec<SharedUniswapTraderJoeSwapPath>,
}

impl Readable for SharedUniswapTraderJoeSwapParameters {
    const SIZE: Option<usize> = None;

    fn read<R>(reader: &mut R) -> io::Result<Self>
    where
        Self: Sized,
        R: io::Read,
    {
        let leg_first_fee = Readable::read(reader)?;
        let path_len = u8::read(reader)?;
        let mut path = Vec::with_capacity(path_len.into());
        for _ in 0..path_len {
            path.push(Readable::read(reader)?);
        }
        Ok(Self {
            leg_first_fee,
            path,
        })
    }
}

impl Writeable for SharedUniswapTraderJoeSwapParameters {
    fn written_size(&self) -> usize {
        1 + self.leg_first_fee.written_size()
            + self.path.iter().map(Writeable::written_size).sum::<usize>()
    }

    fn write<W>(&self, writer: &mut W) -> io::Result<()>
    where
        W: io::Write,
    {
        u8::write(&(self.path.len() as u8), writer)?;
        self.leg_first_fee.write(writer)?;
        for path in &self.path {
            path.write(writer)?;
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SharedUniswapTraderJoeSwapPath {
    pub evm_address: [u8; 20],
    pub fee: Uint24,
}

impl Readable for SharedUniswapTraderJoeSwapPath {
    const SIZE: Option<usize> = Some(23);

    fn read<R>(reader: &mut R) -> io::Result<Self>
    where
        Self: Sized,
        R: io::Read,
    {
        Ok(Self {
            evm_address: Readable::read(reader)?,
            fee: Readable::read(reader)?,
        })
    }
}

impl Writeable for SharedUniswapTraderJoeSwapPath {
    fn written_size(&self) -> usize {
        20 + self.fee.written_size()
    }

    fn write<W>(&self, writer: &mut W) -> io::Result<()>
    where
        W: io::Write,
    {
        self.evm_address.write(writer)?;
        self.fee.write(writer)
    }
}
