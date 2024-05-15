use std::io;

use crate::{
    types::{OutputToken, RedeemMode},
    wormhole_io::{Readable, TypePrefixedPayload, Writeable},
};

#[cfg(feature = "anchor")]
use anchor_lang::prelude::{borsh, AnchorDeserialize, AnchorSerialize};

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "anchor", derive(AnchorSerialize, AnchorDeserialize))]
pub struct SwapMessageV1 {
    pub recipient: [u8; 32],
    pub redeem_mode: RedeemMode,
    pub output_token: OutputToken,
}

impl Readable for SwapMessageV1 {
    fn read<R>(reader: &mut R) -> io::Result<Self>
    where
        Self: Sized,
        R: io::Read,
    {
        Ok(Self {
            recipient: Readable::read(reader)?,
            redeem_mode: Readable::read(reader)?,
            output_token: Readable::read(reader)?,
        })
    }
}

impl Writeable for SwapMessageV1 {
    fn write<W>(&self, writer: &mut W) -> io::Result<()>
    where
        W: io::Write,
    {
        self.recipient.write(writer)?;
        self.redeem_mode.write(writer)?;
        self.output_token.write(writer)
    }
}

impl TypePrefixedPayload<1> for SwapMessageV1 {
    const TYPE: Option<[u8; 1]> = Some([1]);

    fn written_size(&self) -> usize {
        self.redeem_mode
            .written_size()
            .saturating_add(self.output_token.written_size())
            .saturating_add(32) // recipient
    }
}

#[cfg(test)]
mod test {
    use hex_literal::hex;

    use crate::types::{
        OutputSwap, OutputToken, RedeemMode, SwapType, Uint24, Uint48, UniswapSwapParameters,
        UniswapSwapPath,
    };

    use super::*;

    #[test]
    pub fn test_swap_message_v1_usdc_direct() {
        let encoded_fill = hex!("01f00f0000000000000000000000000000000000000000000000000000000000000002000000000000000000000000f62849f9a0b5bf2913b396098f7c7019b51a820a0023010000000000000000000000006ca6d1e2d5347bfab1d91e883f1915560e09129d0000");

        let redeemer_message =
            hex!("010000000000000000000000006ca6d1e2d5347bfab1d91e883f1915560e09129d0000");

        let fill = liquidity_layer_messages::Fill::read_slice(&encoded_fill).unwrap();
        assert_eq!(
            fill,
            liquidity_layer_messages::Fill {
                source_chain: 0xf00f,
                order_sender: hex!(
                    "0000000000000000000000000000000000000000000000000000000000000002"
                ),
                redeemer: hex!("000000000000000000000000f62849f9a0b5bf2913b396098f7c7019b51a820a"),
                redeemer_message: redeemer_message.to_vec().try_into().unwrap()
            }
        );

        let swap_message = SwapMessageV1::read_slice(&redeemer_message).unwrap();
        assert_eq!(
            swap_message,
            SwapMessageV1 {
                recipient: hex!("0000000000000000000000006ca6d1e2d5347bfab1d91e883f1915560e09129d"),
                redeem_mode: RedeemMode::Direct,
                output_token: OutputToken::Usdc,
            }
        );
    }

    #[test]
    pub fn test_swap_message_v1_eth_swap() {
        let encoded_fill = hex!("01f00f0000000000000000000000000000000000000000000000000000000000000002000000000000000000000000f62849f9a0b5bf2913b396098f7c7019b51a820a0053010000000000000000000000006ca6d1e2d5347bfab1d91e883f1915560e09129d00010000000000000000000000000000000000000000010001f4015991a2df15a8f6a256d3ec51e99254cd3fb576a90001f4");

        let redeemer_message =
            hex!("010000000000000000000000006ca6d1e2d5347bfab1d91e883f1915560e09129d00010000000000000000000000000000000000000000010001f4015991a2df15a8f6a256d3ec51e99254cd3fb576a90001f4");

        let fill = liquidity_layer_messages::Fill::read_slice(&encoded_fill).unwrap();
        assert_eq!(
            fill,
            liquidity_layer_messages::Fill {
                source_chain: 0xf00f,
                order_sender: hex!(
                    "0000000000000000000000000000000000000000000000000000000000000002"
                ),
                redeemer: hex!("000000000000000000000000f62849f9a0b5bf2913b396098f7c7019b51a820a"),
                redeemer_message: redeemer_message.to_vec().try_into().unwrap()
            }
        );

        let swap_message = SwapMessageV1::read_slice(&redeemer_message).unwrap();
        assert_eq!(
            swap_message,
            SwapMessageV1 {
                recipient: hex!("0000000000000000000000006ca6d1e2d5347bfab1d91e883f1915560e09129d"),
                redeem_mode: RedeemMode::Direct,
                output_token: OutputToken::Gas(OutputSwap {
                    deadline: 0,
                    limit_amount: 0,
                    swap_type: SwapType::UniswapV3(UniswapSwapParameters {
                        first_leg_fee: Uint24::from(500),
                        path: vec![UniswapSwapPath {
                            evm_address: hex!("5991a2df15a8f6a256d3ec51e99254cd3fb576a9"),
                            fee: Uint24::from(500),
                        },]
                    })
                }),
            }
        );
    }

    #[test]
    pub fn test_swap_message_v1_usdc_relay() {
        let encoded_fill = hex!("01f00f0000000000000000000000000000000000000000000000000000000000000002000000000000000000000000f62849f9a0b5bf2913b396098f7c7019b51a820a002d010000000000000000000000006ca6d1e2d5347bfab1d91e883f1915560e09129d02000000000000000f424000");

        let redeemer_message =
            hex!("010000000000000000000000006ca6d1e2d5347bfab1d91e883f1915560e09129d02000000000000000f424000");

        let fill = liquidity_layer_messages::Fill::read_slice(&encoded_fill).unwrap();
        assert_eq!(
            fill,
            liquidity_layer_messages::Fill {
                source_chain: 0xf00f,
                order_sender: hex!(
                    "0000000000000000000000000000000000000000000000000000000000000002"
                ),
                redeemer: hex!("000000000000000000000000f62849f9a0b5bf2913b396098f7c7019b51a820a"),
                redeemer_message: redeemer_message.to_vec().try_into().unwrap()
            }
        );

        let swap_message = SwapMessageV1::read_slice(&redeemer_message).unwrap();
        assert_eq!(
            swap_message,
            SwapMessageV1 {
                recipient: hex!("0000000000000000000000006ca6d1e2d5347bfab1d91e883f1915560e09129d"),
                redeem_mode: RedeemMode::Relay {
                    gas_dropoff: 0,
                    relaying_fee: Uint48::from(1000000u32),
                },
                output_token: OutputToken::Usdc,
            }
        );
    }

    #[test]
    pub fn test_swap_message_v1_usdc_payload() {
        let encoded_fill = hex!("01f00f0000000000000000000000000000000000000000000000000000000000000002000000000000000000000000f62849f9a0b5bf2913b396098f7c7019b51a820a002b010000000000000000000000006ca6d1e2d5347bfab1d91e883f1915560e09129d0100000004deadbeef00");

        let redeemer_message =
            hex!("010000000000000000000000006ca6d1e2d5347bfab1d91e883f1915560e09129d0100000004deadbeef00");

        let fill = liquidity_layer_messages::Fill::read_slice(&encoded_fill).unwrap();
        assert_eq!(
            fill,
            liquidity_layer_messages::Fill {
                source_chain: 0xf00f,
                order_sender: hex!(
                    "0000000000000000000000000000000000000000000000000000000000000002"
                ),
                redeemer: hex!("000000000000000000000000f62849f9a0b5bf2913b396098f7c7019b51a820a"),
                redeemer_message: redeemer_message.to_vec().try_into().unwrap()
            }
        );

        let swap_message = SwapMessageV1::read_slice(&redeemer_message).unwrap();
        assert_eq!(
            swap_message,
            SwapMessageV1 {
                recipient: hex!("0000000000000000000000006ca6d1e2d5347bfab1d91e883f1915560e09129d"),
                redeem_mode: RedeemMode::Payload(hex!("deadbeef").to_vec()),
                output_token: OutputToken::Usdc,
            }
        );
    }
}
