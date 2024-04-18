use std::io::{self, ErrorKind};

use crate::wormhole_io::{Readable, Writeable};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TraderJoeSwapParameters {
    pub first_pool_id: TraderJoePoolId,
    pub path: Vec<TraderJoeSwapPath>,
}

impl Readable for TraderJoeSwapParameters {
    const SIZE: Option<usize> = None;

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
    fn written_size(&self) -> usize {
        self.first_pool_id
            .written_size()
            .saturating_add(self.path.iter().map(Writeable::written_size).sum::<usize>())
            .saturating_add(1)
    }

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

impl Readable for TraderJoeSwapPath {
    const SIZE: Option<usize> = Some(23);

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
    fn written_size(&self) -> usize {
        self.pool_id.written_size().saturating_add(20)
    }

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

impl Readable for TraderJoePoolId {
    const SIZE: Option<usize> = Some(3);

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
    fn written_size(&self) -> usize {
        Self::SIZE.unwrap()
    }

    fn write<W>(&self, writer: &mut W) -> io::Result<()>
    where
        W: io::Write,
    {
        self.version.write(writer)?;
        self.bin_size.write(writer)
    }
}
