use std::{io, ops::Deref};

use crate::wormhole_io::{Readable, Writeable};
use ruint::{ToUintError, Uint};

/// New type for a 3-byte unsigned integer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Uint24(Uint<24, 1>);

impl Uint24 {
    pub const ZERO: Uint24 = Self(Uint::ZERO);
    pub const BYTES: usize = Uint::<24, 1>::BYTES;
    pub const LAST_INDEX: usize = Self::BYTES - 1;

    pub fn from_be_bytes(bytes: [u8; Self::BYTES]) -> Self {
        let mut out = u64::default();
        for (i, byte) in bytes.into_iter().enumerate() {
            let value = u64::from(byte)
                << usize::saturating_mul(8, usize::saturating_sub(Self::LAST_INDEX, i));
            out = out.saturating_add(value);
        }

        Self(Uint::from(out))
    }

    pub fn from_le_bytes(bytes: [u8; Self::BYTES]) -> Self {
        let mut out = u64::default();
        for (i, byte) in bytes.into_iter().enumerate() {
            let value = u64::from(byte) << usize::saturating_mul(8, i);
            out = out.saturating_add(value);
        }

        Self(Uint::from(out))
    }

    pub fn to_be_bytes(&self) -> [u8; Self::BYTES] {
        self.0.to_be_bytes::<{ Self::BYTES }>()
    }

    pub fn to_le_bytes(&self) -> [u8; Self::BYTES] {
        self.0.to_le_bytes::<{ Self::BYTES }>()
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
    type Error = ToUintError<<Self as Deref>::Target>;

    fn try_from(value: u32) -> Result<Self, Self::Error> {
        Ok(Self(Uint::try_from(value)?))
    }
}

impl TryFrom<u64> for Uint24 {
    type Error = ToUintError<<Self as Deref>::Target>;

    fn try_from(value: u64) -> Result<Self, Self::Error> {
        Ok(Self(Uint::try_from(value)?))
    }
}

impl Readable for Uint24 {
    fn read<R>(reader: &mut R) -> io::Result<Self>
    where
        R: io::Read,
    {
        let mut bytes = <[u8; Self::BYTES]>::default();
        reader.read_exact(&mut bytes)?;
        Ok(Self::from_be_bytes(bytes))
    }
}

impl Writeable for Uint24 {
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
    pub const ZERO: Uint48 = Self(Uint::ZERO);
    pub const BYTES: usize = Uint::<48, 1>::BYTES;
    pub const LAST_INDEX: usize = Self::BYTES - 1;

    pub fn from_be_bytes(bytes: [u8; Self::BYTES]) -> Self {
        let mut out = u64::default();
        for (i, byte) in bytes.into_iter().enumerate() {
            let value = u64::from(byte)
                << usize::saturating_mul(8, usize::saturating_sub(Self::LAST_INDEX, i));
            out = out.saturating_add(value);
        }

        Self(Uint::from(out))
    }

    pub fn from_le_bytes(bytes: [u8; Self::BYTES]) -> Self {
        let mut out = u64::default();
        for (i, byte) in bytes.into_iter().enumerate() {
            let value = u64::from(byte) << usize::saturating_mul(8, i);
            out = out.saturating_add(value);
        }

        Self(Uint::from(out))
    }

    pub fn to_be_bytes(&self) -> [u8; Self::BYTES] {
        self.0.to_be_bytes::<{ Self::BYTES }>()
    }

    pub fn to_le_bytes(&self) -> [u8; Self::BYTES] {
        self.0.to_le_bytes::<{ Self::BYTES }>()
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
    type Error = ToUintError<<Self as Deref>::Target>;

    fn try_from(value: u64) -> Result<Self, Self::Error> {
        Ok(Self(Uint::try_from(value)?))
    }
}

impl Readable for Uint48 {
    fn read<R>(reader: &mut R) -> io::Result<Self>
    where
        R: io::Read,
    {
        let mut bytes = <[u8; Self::BYTES]>::default();
        reader.read_exact(&mut bytes)?;
        Ok(Self::from_be_bytes(bytes))
    }
}

impl Writeable for Uint48 {
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
    fn test_uint24_small_be() {
        const EXPECTED: u64 = 69;

        let encoded = hex!("000045");
        let value = Uint24::from_be_bytes(encoded);
        assert_eq!(value.0, Uint::from(EXPECTED));
        assert_eq!(value.to_be_bytes(), encoded);

        let value = <Uint24 as Readable>::read(&mut &encoded[..]).unwrap();
        assert_eq!(value.0, Uint::from(EXPECTED));

        let mut written = [0u8; 3];
        value.write(&mut written.as_mut_slice()).unwrap();
        assert_eq!(written, encoded);
    }

    #[test]
    fn test_uint24_large_be() {
        const EXPECTED: u64 = 4408389;

        let encoded = hex!("434445");
        let value = Uint24::from_be_bytes(encoded);
        assert_eq!(value.0, Uint::from(EXPECTED));
        assert_eq!(value.to_be_bytes(), encoded);

        let value = <Uint24 as Readable>::read(&mut &encoded[..]).unwrap();
        assert_eq!(value.0, Uint::from(EXPECTED));

        let mut written = [0u8; 3];
        value.write(&mut written.as_mut_slice()).unwrap();
        assert_eq!(written, encoded);
    }

    #[test]
    fn test_uint48_small_be() {
        const EXPECTED: u64 = 69;

        let encoded = hex!("000000000045");
        let value = Uint48::from_be_bytes(encoded);
        assert_eq!(value.0, Uint::from(EXPECTED));
        assert_eq!(value.to_be_bytes(), encoded);

        let value = <Uint48 as Readable>::read(&mut &encoded[..]).unwrap();
        assert_eq!(value.0, Uint::from(EXPECTED));

        let mut written = [0u8; 6];
        value.write(&mut written.as_mut_slice()).unwrap();
        assert_eq!(written, encoded);
    }

    #[test]
    fn test_uint48_large_be() {
        const EXPECTED: u64 = 70649028756549;

        let encoded = hex!("404142434445");
        let value = Uint48::from_be_bytes(encoded);
        assert_eq!(value.0, Uint::from(EXPECTED));
        assert_eq!(value.to_be_bytes(), encoded);

        let value = <Uint48 as Readable>::read(&mut &encoded[..]).unwrap();
        assert_eq!(value.0, Uint::from(EXPECTED));

        let mut written = [0u8; 6];
        value.write(&mut written.as_mut_slice()).unwrap();
        assert_eq!(written, encoded);
    }
}
