use std::io;

use crate::{
    types::Uint48,
    wormhole_io::{Readable, Writeable, WriteableBytes},
};

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub enum RedeemMode {
    #[default]
    Direct,
    Payload {
        sender: [u8; 32],
        buf: WriteableBytes<u16>,
    },
    Relay {
        gas_dropoff: u32,
        relaying_fee: crate::types::Uint48,
    },
}

impl RedeemMode {
    const DIRECT: u8 = 0;
    const PAYLOAD: u8 = 1;
    const RELAY: u8 = 2;

    pub fn written_size(&self) -> usize {
        match self {
            Self::Direct => 1,
            Self::Payload { sender: _, buf } => buf.len().saturating_add(
                1 // discriminant
                + 32 // sender
                + 4, // payload len
            ),
            Self::Relay { .. } => {
                const FIXED: usize = 1 // discriminant
                    + 4 // gas_dropoff
                    + Uint48::BYTES; // relaying_fee

                FIXED
            }
        }
    }
}

impl Readable for RedeemMode {
    fn read<R>(reader: &mut R) -> io::Result<Self>
    where
        Self: Sized,
        R: io::Read,
    {
        match u8::read(reader)? {
            Self::DIRECT => Ok(Self::Direct),
            Self::PAYLOAD => Ok(Self::Payload {
                sender: Readable::read(reader)?,
                buf: Readable::read(reader)?,
            }),
            Self::RELAY => Ok(Self::Relay {
                gas_dropoff: Readable::read(reader)?,
                relaying_fee: Readable::read(reader)?,
            }),
            _ => Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Invalid RedeemMode",
            )),
        }
    }
}

impl Writeable for RedeemMode {
    fn write<W>(&self, writer: &mut W) -> io::Result<()>
    where
        W: io::Write,
    {
        match self {
            Self::Direct => Self::DIRECT.write(writer),
            Self::Payload { sender, buf } => {
                Self::PAYLOAD.write(writer)?;
                sender.write(writer)?;
                buf.write(writer)
            }
            Self::Relay {
                gas_dropoff,
                relaying_fee,
            } => {
                Self::RELAY.write(writer)?;
                gas_dropoff.write(writer)?;
                relaying_fee.write(writer)
            }
        }
    }
}
