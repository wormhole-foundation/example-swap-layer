use std::io;

use crate::wormhole_io::{Readable, Writeable};

#[cfg(feature = "anchor")]
use anchor_lang::prelude::{borsh, AnchorDeserialize, AnchorSerialize};

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "anchor", derive(AnchorSerialize, AnchorDeserialize))]
pub struct JupiterV6SwapParameters {
    pub dex_program_id: Option<[u8; 32]>,
}

impl JupiterV6SwapParameters {
    pub fn written_size(&self) -> usize {
        match self.dex_program_id {
            Some(_) => 33,
            None => 1,
        }
    }
}

impl Readable for JupiterV6SwapParameters {
    fn read<R>(reader: &mut R) -> io::Result<Self>
    where
        Self: Sized,
        R: io::Read,
    {
        Ok(Self {
            dex_program_id: Readable::read(reader)?,
        })
    }
}

impl Writeable for JupiterV6SwapParameters {
    fn write<W>(&self, writer: &mut W) -> io::Result<()>
    where
        W: io::Write,
    {
        self.dex_program_id.write(writer)
    }
}

#[cfg(test)]
mod test {
    use hex_literal::hex;
    use solana_program::pubkey::Pubkey;
    use wormhole_io::{Readable, Writeable};

    use super::JupiterV6SwapParameters;

    #[test]
    fn dex_program_id_some() {
        let dex_program_id = Pubkey::from([88; 32]);
        let params = JupiterV6SwapParameters {
            dex_program_id: Some(dex_program_id.to_bytes()),
        };

        let mut encoded = [0; 33];
        assert_eq!(params.written_size(), encoded.len());

        params.write(&mut encoded.as_mut_slice()).unwrap();
        assert_eq!(
            encoded,
            hex!("015858585858585858585858585858585858585858585858585858585858585858")
        );

        let decoded = JupiterV6SwapParameters::read(&mut &encoded[..]).unwrap();
        assert_eq!(decoded, params);
    }

    #[test]
    fn dex_program_id_none() {
        let params = JupiterV6SwapParameters {
            dex_program_id: Default::default(),
        };

        let mut encoded = [0; 1];
        assert_eq!(params.written_size(), encoded.len());

        params.write(&mut encoded.as_mut_slice()).unwrap();
        assert_eq!(encoded, hex!("00"));

        let decoded = JupiterV6SwapParameters::read(&mut &encoded[..]).unwrap();
        assert_eq!(decoded, params);
    }
}
