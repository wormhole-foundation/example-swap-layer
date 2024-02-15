use anchor_lang::prelude::*;
use std::{
  io,
  io::{Error, ErrorKind}
};
use wormhole_io::{Readable, TypePrefixedPayload, Writeable, WriteableBytes};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RedeemMode {
  Direct,
  Payload(WriteableBytes),
  Relay{
    gas_dropoff: u64, //serialized as u32
    relaying_fee: u64 //serialized as u48
  },
}

impl RedeemMode {
  const DIRECT:  u8 = 0;
  const PAYLOAD: u8 = 1;
  const RELAY:   u8 = 2;
}

fn read_u48_as_u64<R>(reader: &mut R) -> io::Result<u64> where R: io::Read {
  Ok(((u16::read(reader)? as u64) << 32) + u32::read(reader)? as u64)
}

fn write_u64_as_u48<W>(writer: &mut W, value: u64) -> io::Result<()> where W: io::Write {
  ((value >> 32) as u16).write(writer)?;
  (value         as u32).write(writer)
}

impl Readable for RedeemMode {
  const SIZE: Option<usize> = None;

  fn read<R>(reader: &mut R) -> io::Result<Self> where Self: Sized, R: io::Read {
    match u8::read(reader)? {
      Self::DIRECT  => Ok(Self::Direct),
      Self::PAYLOAD => Ok(Self::Payload(Readable::read(reader)?)),
      Self::RELAY   => Ok(Self::Relay{
                         gas_dropoff:  u32::read(reader)? as u64,
                         relaying_fee: read_u48_as_u64(reader)?,
                       }),
      _             => Err(Error::new(ErrorKind::InvalidData, "Invalid RedeemMode")),
    }
  }
}

impl Writeable for RedeemMode {
  fn written_size(&self) -> usize {
    1 + match self {
      Self::Direct           => 0,
      Self::Payload(payload) => payload.written_size(),
      Self::Relay{..}        => 4 + 6,
    }
  }

  fn write<W>(&self, writer: &mut W) -> io::Result<()> where Self: Sized, W: io::Write {
    match self {
      Self::Direct =>
        Self::DIRECT.write(writer),
      Self::Payload(payload) => {
        Self::PAYLOAD.write(writer)?;
        payload      .write(writer)
      },
      Self::Relay{gas_dropoff, relaying_fee} => {
        if (*gas_dropoff >> 32) != 0 || (*relaying_fee >> 48) != 0 {
          return Err(Error::new(ErrorKind::InvalidData, "Relay parameter values out of range"));
        }
        Self::RELAY.write(writer)?;
        (*gas_dropoff as u32).write(writer)?;
        write_u64_as_u48(writer, *relaying_fee)
      },
    }
  }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OutputMode {
  Usdc,
  Gas(OutputSwap),
  Token(OutputSwap),
}

impl OutputMode {
  const USDC:  u8 = 0;
  const GAS:   u8 = 1;
  const TOKEN: u8 = 2;
}

impl Readable for OutputMode {
  const SIZE: Option<usize> = None;

  fn read<R>(reader: &mut R) -> io::Result<Self> where Self: Sized, R: io::Read {
    match u8::read(reader)? {
      Self::USDC  => Ok(Self::Usdc),
      Self::GAS   => Ok(Self::Gas(Readable::read(reader)?)),
      Self::TOKEN => Ok(Self::Token(Readable::read(reader)?)),
      _           => Err(Error::new(ErrorKind::InvalidData, "Invalid OutputMode")),
    }
  }
}

impl Writeable for OutputMode {
  fn written_size(&self) -> usize {
    1 + match self {
      Self::Usdc               => 0,
      Self::Gas(output_swap)   => output_swap.written_size(),
      Self::Token(output_swap) => output_swap.written_size(),
    }
  }

  fn write<W>(&self, writer: &mut W) -> io::Result<()> where Self: Sized, W: io::Write {
    match self {
      Self::Usdc =>
        Self::USDC .write(writer),
      Self::Gas(output_swap) => {
        Self::GAS  .write(writer)?;
        output_swap.write(writer)
      },
      Self::Token(output_swap) => {
        Self::TOKEN.write(writer)?;
        output_swap.write(writer)
      },
    }
  }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OutputSwap {
  deadline: u32,
  limit_amount: u64, //serialized as u128
  swap_type: SwapType,
}

impl Readable for OutputSwap {
  const SIZE: Option<usize> = None;

  fn read<R>(reader: &mut R) -> io::Result<Self> where Self: Sized, R: io::Read {
    Ok(Self {
      deadline: u32::read(reader)?,
      limit_amount: {
        if u64::read(reader)? != 0 {
          return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "OutputSwap limit_amount must fit in u64"
          ));
        }
        u64::read(reader)?
      },
      swap_type: Readable::read(reader)?,
    })
  }
}

impl Writeable for OutputSwap {
  fn written_size(&self) -> usize {
    4 + 16 + self.swap_type.written_size()
  }

  fn write<W>(&self, writer: &mut W) -> io::Result<()> where Self: Sized, W: io::Write {
    self.deadline.write(writer)?;
    0u64.write(writer)?;
    self.limit_amount.write(writer)?;
    self.swap_type.write(writer)
  }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SwapType {
  OracOneHop,
  OrcaTwoHop(Pubkey), //intermediate token mint
}

impl SwapType {
  const ORAC_ONE_HOP: u8 = 10;
  const ORCA_TWO_HOP: u8 = 11;
}

impl Readable for SwapType {
  const SIZE: Option<usize> = None;

  fn read<R>(reader: &mut R) -> io::Result<Self> where Self: Sized, R: io::Read {
    match u8::read(reader)? {
      Self::ORAC_ONE_HOP => Ok(Self::OracOneHop),
      Self::ORCA_TWO_HOP => Ok(Self::OrcaTwoHop(<[u8; 32]>::read(reader)?.into())),
      _                  => Err(Error::new(ErrorKind::InvalidData, "Invalid SwapType")),
    }
  }
}

impl Writeable for SwapType {
  fn written_size(&self) -> usize {
    1 + match self {
      Self::OracOneHop    => 0,
      Self::OrcaTwoHop(_) => 32,
    }
  }

  fn write<W>(&self, writer: &mut W) -> io::Result<()> where Self: Sized, W: io::Write {
    match self {
      Self::OracOneHop =>
        Self::ORAC_ONE_HOP.write(writer),
      Self::OrcaTwoHop(mint) => {
        Self::ORCA_TWO_HOP.write(writer)?;
        mint.to_bytes()   .write(writer)
      },
    }
  }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SwapMessage {
  pub recipient:   Pubkey,
  pub redeem_mode: RedeemMode,
  pub output_mode: OutputMode,
}

impl Readable for SwapMessage {
  const SIZE: Option<usize> = None;

  fn read<R>(reader: &mut R) -> io::Result<Self> where Self: Sized, R: io::Read {
    Ok(Self {
      recipient: <[u8; 32]>::read(reader)?.into(),
      redeem_mode: Readable::read(reader)?,
      output_mode: Readable::read(reader)?,
    })
  }
}

impl Writeable for SwapMessage {
  fn written_size(&self) -> usize {
    32 + self.redeem_mode.written_size() + self.output_mode.written_size()
  }

  fn write<W>(&self, writer: &mut W) -> io::Result<()> where Self: Sized, W: io::Write {
    self.recipient.to_bytes().write(writer)?;
    self.redeem_mode         .write(writer)?;
    self.output_mode         .write(writer)
  }
}

impl TypePrefixedPayload for SwapMessage {
  const TYPE: Option<u8> = Some(1); //version field
}

impl AnchorDeserialize for SwapMessage {
  fn deserialize_reader<R: std::io::Read>(reader: &mut R) -> std::io::Result<Self> {
    Self::read(reader)
  }
}

//we never write SwapMessages and never initialize them either
impl Space for SwapMessage {
  const INIT_SPACE: usize = 0;
}

impl AnchorSerialize for SwapMessage {
  fn serialize<W: std::io::Write>(&self, writer: &mut W) -> std::io::Result<()> {
    Err(Error::new(ErrorKind::Other, "SwapMessages should only be read, never written"))
  }
}
