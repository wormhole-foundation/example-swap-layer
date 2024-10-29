use std::io::{self, ErrorKind};

use crate::wormhole_io::{Readable, Writeable};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TraderJoeSwapParameters {
    pub first_pool_id: TraderJoePoolId,
    pub path: Vec<TraderJoeSwapPath>,
}

impl TraderJoeSwapParameters {
    pub fn written_size(&self) -> usize {
        const FIXED: usize = TraderJoePoolId::ENCODED_SIZE
            + 1 // path_len
        ;
        self.path
            .len()
            .saturating_mul(TraderJoeSwapPath::ENCODED_SIZE)
            .saturating_add(FIXED)
    }
}

impl Readable for TraderJoeSwapParameters {
    fn read<R>(reader: &mut R) -> io::Result<Self>
    where
        Self: Sized,
        R: io::Read,
    {
        let first_pool_id = Readable::read(reader)?;

        let path_len = u8::read(reader)?;
        let mut path = Vec::with_capacity(path_len.into());
        for _ in 0..path_len {
            path.push(Readable::read(reader)?);
        }
        Ok(Self {
            first_pool_id,
            path,
        })
    }
}

impl Writeable for TraderJoeSwapParameters {
    fn write<W>(&self, writer: &mut W) -> io::Result<()>
    where
        W: io::Write,
    {
        self.first_pool_id.write(writer)?;

        let path_len = u8::try_from(self.path.len()).map_err(|_| ErrorKind::InvalidInput)?;
        path_len.write(writer)?;
        for path in &self.path {
            path.write(writer)?;
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TraderJoeSwapPath {
    pub evm_address: [u8; 20],
    pub pool_id: TraderJoePoolId,
}

impl TraderJoeSwapPath {
    const ENCODED_SIZE: usize = 20 + TraderJoePoolId::ENCODED_SIZE;
}

impl Readable for TraderJoeSwapPath {
    fn read<R>(reader: &mut R) -> io::Result<Self>
    where
        Self: Sized,
        R: io::Read,
    {
        Ok(Self {
            evm_address: Readable::read(reader)?,
            pool_id: Readable::read(reader)?,
        })
    }
}
impl Writeable for TraderJoeSwapPath {
    fn write<W>(&self, writer: &mut W) -> io::Result<()>
    where
        W: io::Write,
    {
        self.evm_address.write(writer)?;
        self.pool_id.write(writer)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TraderJoePoolId {
    pub version: u8,
    pub bin_size: u16,
}

impl TraderJoePoolId {
    const ENCODED_SIZE: usize = 3;
}

impl Readable for TraderJoePoolId {
    fn read<R>(reader: &mut R) -> io::Result<Self>
    where
        Self: Sized,
        R: io::Read,
    {
        Ok(Self {
            version: u8::read(reader)?,
            bin_size: u16::read(reader)?,
        })
    }
}

impl Writeable for TraderJoePoolId {
    fn write<W>(&self, writer: &mut W) -> io::Result<()>
    where
        W: io::Write,
    {
        self.version.write(writer)?;
        self.bin_size.write(writer)
    }
}
