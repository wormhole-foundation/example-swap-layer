import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

export type RedeemOption =
    | {
          relay: {
              gasDropoff: number;
              maxRelayerFee: BN;
          };
      }
    | {
          payload: [Buffer];
      };

export type StagedRedeem =
    | { direct: {} }
    | { relay: { gasDropoff: number; relayingFee: BN } }
    | { payload: { 0: Buffer } };

export type StagedOutboundInfo = {
    custodyTokenBump: number;
    preparedBy: PublicKey;
    sender: PublicKey;
    targetChain: number;
    recipient: Array<number>;
    isExactIn: boolean;
    usdcRefundToken: PublicKey;
    minAmountOut: BN | null;
};

export class StagedOutbound {
    info: StagedOutboundInfo;
    stagedRedeem: StagedRedeem;
    encodedOutputToken: Buffer;

    constructor(info: StagedOutboundInfo, stagedRedeem: StagedRedeem, encodedOutputToken: Buffer) {
        this.info = info;
        this.stagedRedeem = stagedRedeem;
        this.encodedOutputToken = encodedOutputToken;
    }
}
