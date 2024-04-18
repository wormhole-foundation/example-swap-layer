mod output;
pub use output::*;

mod swap_type;
pub use swap_type::*;

mod uint;
pub use uint::*;

use std::io;

use crate::wormhole_io::{Readable, Writeable, WriteableBytes};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RedeemMode {
    Direct,
    Payload(WriteableBytes),
    Relay {
        gas_dropoff: u32,
        relaying_fee: crate::types::Uint48,
    },
}

impl RedeemMode {
    const DIRECT: u8 = 0;
    const PAYLOAD: u8 = 1;
    const RELAY: u8 = 2;
}

impl Readable for RedeemMode {
    const SIZE: Option<usize> = None;

    fn read<R>(reader: &mut R) -> io::Result<Self>
    where
        Self: Sized,
        R: io::Read,
    {
        match u8::read(reader)? {
            Self::DIRECT => Ok(Self::Direct),
            Self::PAYLOAD => Ok(Self::Payload(Readable::read(reader)?)),
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
    fn written_size(&self) -> usize {
        match self {
            Self::Direct => 1,
            Self::Payload(payload) => payload.written_size().saturating_add(1),
            Self::Relay {
                gas_dropoff,
                relaying_fee,
            } => gas_dropoff
                .written_size()
                .saturating_add(relaying_fee.written_size())
                .saturating_add(1),
        }
    }

    fn write<W>(&self, writer: &mut W) -> io::Result<()>
    where
        W: io::Write,
    {
        match self {
            Self::Direct => Self::DIRECT.write(writer),
            Self::Payload(payload) => {
                Self::PAYLOAD.write(writer)?;
                payload.write(writer)
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
