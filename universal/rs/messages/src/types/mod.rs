mod output;
pub use output::*;

mod swap_type;
pub use swap_type::*;

mod uint;
pub use uint::*;

use std::io;

use crate::wormhole_io::{Readable, Writeable, WriteableBytes};

#[cfg(feature = "anchor")]
use anchor_lang::prelude::{borsh, AnchorDeserialize, AnchorSerialize};

#[derive(Debug, Default, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "anchor", derive(AnchorSerialize, AnchorDeserialize))]
pub enum RedeemMode {
    #[default]
    Direct,
    Payload(Vec<u8>),
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
            Self::Payload(payload) => payload.len().saturating_add(
                1 // discriminant
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

impl TryFrom<(u32, u64)> for RedeemMode {
    type Error = <Uint48 as TryFrom<u64>>::Error;

    fn try_from((gas_dropoff, relaying_fee): (u32, u64)) -> Result<Self, Self::Error> {
        Ok(Self::Relay {
            gas_dropoff,
            relaying_fee: relaying_fee.try_into()?,
        })
    }
}

impl From<Vec<u8>> for RedeemMode {
    fn from(payload: Vec<u8>) -> Self {
        Self::Payload(payload)
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
            Self::PAYLOAD => Ok(Self::Payload(
                WriteableBytes::<u32>::read(reader).map(Into::into)?,
            )),
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
            Self::Payload(payload) => {
                Self::PAYLOAD.write(writer)?;

                let writeable = unsafe_writeable_bytes_ref(payload);

                // Check whether length can be encoded.
                writeable.try_encoded_len()?;
                writeable.write(writer)
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

fn unsafe_writeable_bytes_ref(bytes: &Vec<u8>) -> &WriteableBytes<u32> {
    unsafe { std::mem::transmute::<&Vec<u8>, &WriteableBytes<u32>>(bytes) }
}
