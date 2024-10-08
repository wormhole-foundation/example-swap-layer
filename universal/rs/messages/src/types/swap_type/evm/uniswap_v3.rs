use std::io::{self, ErrorKind};

use crate::types::Uint24;
use crate::wormhole_io::{Readable, Writeable};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UniswapSwapParameters {
    pub first_leg_fee: Uint24,
    pub path: Vec<UniswapSwapPath>,
}

impl UniswapSwapParameters {
    pub fn written_size(&self) -> usize {
        const FIXED: usize = Uint24::BYTES
            + 1 // path_len
        ;
        self.path
            .len()
            .saturating_mul(UniswapSwapPath::ENCODED_SIZE)
            .saturating_add(FIXED)
    }
}

impl Readable for UniswapSwapParameters {
    fn read<R>(reader: &mut R) -> io::Result<Self>
    where
        Self: Sized,
        R: io::Read,
    {
        let first_leg_fee = Readable::read(reader)?;

        let path_len = u8::read(reader)?;
        let mut path = Vec::with_capacity(path_len.into());
        for _ in 0..path_len {
            path.push(Readable::read(reader)?);
        }
        Ok(Self {
            first_leg_fee,
            path,
        })
    }
}

impl Writeable for UniswapSwapParameters {
    fn write<W>(&self, writer: &mut W) -> io::Result<()>
    where
        W: io::Write,
    {
        self.first_leg_fee.write(writer)?;

        let path_len = u8::try_from(self.path.len()).map_err(|_| ErrorKind::InvalidInput)?;
        path_len.write(writer)?;
        for path in &self.path {
            path.write(writer)?;
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UniswapSwapPath {
    pub evm_address: [u8; 20],
    pub fee: Uint24,
}

impl UniswapSwapPath {
    const ENCODED_SIZE: usize = 20 + Uint24::BYTES;
}

impl Readable for UniswapSwapPath {
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
impl Writeable for UniswapSwapPath {
    fn write<W>(&self, writer: &mut W) -> io::Result<()>
    where
        W: io::Write,
    {
        self.evm_address.write(writer)?;
        self.fee.write(writer)
    }
}
