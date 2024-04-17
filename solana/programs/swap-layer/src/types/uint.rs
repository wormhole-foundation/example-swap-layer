use std::{io, ops::Deref};

use common::wormhole_io::{Readable, Writeable};
use ruint::{ToUintError, Uint};

/// New type for a 3-byte unsigned integer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Uint24(Uint<24, 1>);

impl Uint24 {
    pub fn from_be_bytes(bytes: [u8; 3]) -> Self {
        let mut value = u64::default();
        for (i, byte) in bytes.into_iter().enumerate() {
            value += u64::from(byte) << (8 * (2 - i));
        }

        Self(Uint::from(value))
    }

    pub fn to_be_bytes(self) -> [u8; 3] {
        let value = u64::from(self);
        let mut bytes = <[u8; 3]>::default();
        for (i, byte) in bytes.iter_mut().enumerate() {
            *byte = ((value >> (8 * (2 - i))) % 256) as u8;
        }

        bytes
    }
}

impl Deref for Uint24 {
    type Target = Uint<24, 1>;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl From<Uint24> for Uint<24, 1> {
    fn from(value: Uint24) -> Self {
        value.0
    }
}

impl From<Uint24> for u64 {
    fn from(value: Uint24) -> Self {
        value.0.into_limbs()[0]
    }
}

impl From<u16> for Uint24 {
    fn from(value: u16) -> Self {
        Self(Uint::from(value))
    }
}

impl TryFrom<u32> for Uint24 {
    type Error = ToUintError<Uint<24, 1>>;

    fn try_from(value: u32) -> Result<Self, Self::Error> {
        Ok(Self(Uint::try_from(value)?))
    }
}

impl TryFrom<u64> for Uint24 {
    type Error = ToUintError<Uint<24, 1>>;

    fn try_from(value: u64) -> Result<Self, Self::Error> {
        Ok(Self(Uint::try_from(value)?))
    }
}

impl Readable for Uint24 {
    const SIZE: Option<usize> = Some(3);

    fn read<R>(reader: &mut R) -> io::Result<Self>
    where
        R: io::Read,
    {
        let mut bytes = <[u8; 3]>::default();
        reader.read_exact(&mut bytes)?;
        Ok(Self::from_be_bytes(bytes))
    }
}

impl Writeable for Uint24 {
    fn written_size(&self) -> usize {
        Self::SIZE.unwrap()
    }

    fn write<W>(&self, writer: &mut W) -> io::Result<()>
    where
        W: io::Write,
    {
        writer.write_all(&self.to_be_bytes())
    }
}

/// New type for a 6-byte unsigned integer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Uint48(Uint<48, 1>);

impl Uint48 {
    pub fn from_be_bytes(bytes: [u8; 6]) -> Self {
        let mut value = u64::default();
        for (i, byte) in bytes.into_iter().enumerate() {
            value += u64::from(byte) << (8 * (5 - i));
        }

        Self(Uint::from(value))
    }

    pub fn to_be_bytes(self) -> [u8; 6] {
        let value = u64::from(self);
        let mut bytes = <[u8; 6]>::default();
        for (i, byte) in bytes.iter_mut().enumerate() {
            *byte = ((value >> (8 * (5 - i))) % 256) as u8;
        }

        bytes
    }
}

impl Deref for Uint48 {
    type Target = Uint<48, 1>;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl From<Uint48> for Uint<48, 1> {
    fn from(value: Uint48) -> Self {
        value.0
    }
}

impl From<Uint48> for u64 {
    fn from(value: Uint48) -> Self {
        value.0.into_limbs()[0]
    }
}

impl From<u16> for Uint48 {
    fn from(value: u16) -> Self {
        Self(Uint::from(value))
    }
}

impl From<u32> for Uint48 {
    fn from(value: u32) -> Self {
        Self(Uint::from(value))
    }
}

impl TryFrom<u64> for Uint48 {
    type Error = ToUintError<Uint<48, 1>>;

    fn try_from(value: u64) -> Result<Self, Self::Error> {
        Ok(Self(Uint::try_from(value)?))
    }
}

impl Readable for Uint48 {
    const SIZE: Option<usize> = Some(6);

    fn read<R>(reader: &mut R) -> io::Result<Self>
    where
        R: io::Read,
    {
        let mut bytes = <[u8; 6]>::default();
        reader.read_exact(&mut bytes)?;
        Ok(Self::from_be_bytes(bytes))
    }
}

impl Writeable for Uint48 {
    fn written_size(&self) -> usize {
        Self::SIZE.unwrap()
    }

    fn write<W>(&self, writer: &mut W) -> io::Result<()>
    where
        W: io::Write,
    {
        writer.write_all(&self.to_be_bytes())
    }
}

#[cfg(test)]
mod test {
    use hex_literal::hex;

    use super::*;

    #[test]
    fn test_uint24_small() {
        const EXPECTED: u64 = 69;

        let encoded = hex!("000045");
        let value = Uint24::from_be_bytes(encoded);
        assert_eq!(value.0, Uint::from(EXPECTED));
        assert_eq!(value.to_be_bytes(), encoded);

        let value = <Uint24 as Readable>::read(&mut &encoded[..]).unwrap();
        assert_eq!(value.0, Uint::from(EXPECTED));
    }

    #[test]
    fn test_uint24_large() {
        const EXPECTED: u64 = 4408389;

        let encoded = hex!("434445");
        let value = Uint24::from_be_bytes(encoded);
        assert_eq!(value.0, Uint::from(EXPECTED));
        assert_eq!(value.to_be_bytes(), encoded);

        let value = <Uint24 as Readable>::read(&mut &encoded[..]).unwrap();
        assert_eq!(value.0, Uint::from(EXPECTED));
    }

    #[test]
    fn test_uint48_small() {
        const EXPECTED: u64 = 69;

        let encoded = hex!("000000000045");
        let value = Uint48::from_be_bytes(encoded);
        assert_eq!(value.0, Uint::from(EXPECTED));
        assert_eq!(value.to_be_bytes(), encoded);

        let value = <Uint48 as Readable>::read(&mut &encoded[..]).unwrap();
        assert_eq!(value.0, Uint::from(EXPECTED));
    }

    #[test]
    fn test_uint48_large() {
        const EXPECTED: u64 = 70649028756549;

        let encoded = hex!("404142434445");
        let value = Uint48::from_be_bytes(encoded);
        assert_eq!(value.0, Uint::from(EXPECTED));
        assert_eq!(value.to_be_bytes(), encoded);

        let value = <Uint48 as Readable>::read(&mut &encoded[..]).unwrap();
        assert_eq!(value.0, Uint::from(EXPECTED));
    }
}
