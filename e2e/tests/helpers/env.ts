import * as fs from "fs";
import { parse as envParse } from "envfile";
import { Chain } from "@wormhole-foundation/sdk-base";
import { EVM_CONFIG, EVM_LOCALHOSTS, EVM_PRIVATE_KEY, RELAYER_PRIVATE_KEY, USDT_ETH } from "./";
import { ethers } from "ethers";
import { abi as swapLayerAbi } from "../../../evm/out/ISwapLayer.sol/ISwapLayer.json";
import { abi as wormholeAbi } from "../../../evm/out/IWormhole.sol/IWormhole.json";
import { abi as tokenMessengerAbi } from "../../../evm/out/ITokenMessenger.sol/ITokenMessenger.json";
import { abi as messageTransmitterAbi } from "../../../evm/out/IMessageTransmitter.sol/IMessageTransmitter.json";

export type SwapLayerEnv = {
    tokenRouter: string;
    swapLayer: string;
    coreBridge: string;
    circleTokenMessenger: string;
    usdc: string;
};

export function parseSwapLayerEnvFile(envPath: string): SwapLayerEnv {
    if (!fs.existsSync(envPath)) {
        console.log(envPath);
        throw new Error(`${envPath} non-existent`);
    }

    const raw = fs.readFileSync(envPath, "utf8");
    const contents = envParse(raw.replace(/export RELEASE_/g, ""));

    const keys = ["TOKEN_ROUTER", "SWAP_LAYER", "TOKEN_MESSENGER", "WORMHOLE", "USDC"];
    for (const key of keys) {
        if (!contents[key]) {
            throw new Error(`no ${key}`);
        }
    }

    return {
        tokenRouter: contents.TOKEN_ROUTER,
        swapLayer: contents.SWAP_LAYER,
        coreBridge: contents.WORMHOLE,
        circleTokenMessenger: contents.TOKEN_MESSENGER,
        usdc: contents.USDC,
    };
}

export function baseContract(
    chain: Chain,
    abi: any,
    address: string,
): {
    provider: ethers.providers.JsonRpcProvider;
    wallet: ethers.Wallet;
    contract: ethers.Contract;
} {
    const provider = new ethers.providers.JsonRpcProvider(EVM_LOCALHOSTS[chain]);
    const wallet = new ethers.Wallet(EVM_PRIVATE_KEY, provider);
    const contract = new ethers.Contract(address, abi, wallet);

    return { provider, wallet, contract };
}

export function evmSwapLayerConfig(chain: Chain): {
    provider: ethers.providers.JsonRpcProvider;
    wallet: ethers.Wallet;
    relayer: ethers.Wallet;
    contract: ethers.Contract;
} {
    const base = baseContract(chain, swapLayerAbi, EVM_CONFIG[chain].swapLayer);

    return { ...base, relayer: new ethers.Wallet(RELAYER_PRIVATE_KEY, base.provider) };
}

export function wormholeContract(chain: Chain): {
    provider: ethers.providers.JsonRpcProvider;
    wallet: ethers.Wallet;
    contract: ethers.Contract;
} {
    return baseContract(chain, wormholeAbi, EVM_CONFIG[chain].coreBridge);
}

export async function circleContract(chain: Chain): Promise<{
    provider: ethers.providers.JsonRpcProvider;
    wallet: ethers.Wallet;
    tokenMessenger: ethers.Contract;
    messageTransmitter: ethers.Contract;
}> {
    const {
        provider,
        wallet,
        contract: tokenMessenger,
    } = baseContract(chain, tokenMessengerAbi, EVM_CONFIG[chain].circleTokenMessenger);

    // Create a message transmitter contract too.
    const messageTransmitterAddress = await tokenMessenger.localMessageTransmitter();
    const messageTransmitter = new ethers.Contract(
        messageTransmitterAddress,
        messageTransmitterAbi,
        wallet,
    );

    return { provider, wallet, tokenMessenger, messageTransmitter };
}

export function usdcContract(chain: Chain) {
    return baseContract(
        chain,
        [
            "function allowance(address owner, address spender) external view returns (uint256)",
            "function approve(address spender, uint256 amount) returns (bool)",
            "function mint(address to, uint256 amount)",
            "function balanceOf(address account) external view returns (uint256)",
            "function transfer(address recipient, uint256 amount) external returns (bool)",
            "function configureMinter(address minter, uint256 minterAllowedAmount)",
            "function masterMinter() external view returns (address)",
        ],
        EVM_CONFIG[chain].usdc,
    );
}

export function usdtContract() {
    return baseContract(
        "Ethereum",
        [
            "function allowance(address owner, address spender) external view returns (uint256)",
            "function approve(address spender, uint256 amount) returns (bool)",
            "function balanceOf(address account) external view returns (uint256)",
            "function transfer(address recipient, uint256 amount) external returns (bool)",
        ],
        USDT_ETH,
    );
}
