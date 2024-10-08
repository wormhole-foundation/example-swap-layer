import { ethers } from "ethers";
import { assert } from "chai";
import { GUARDIAN_PRIVATE_KEY, circleContract, wormholeContract, usdcContract } from ".";
import { Chain } from "@wormhole-foundation/sdk-base";

export async function overrideWormholeAnvil(chain: Chain, guardianSetIndex: number): Promise<void> {
    const { provider, contract: coreBridge } = wormholeContract(chain);

    const abiCoder = ethers.utils.defaultAbiCoder;

    const currGuardianSetIndex = await coreBridge.getCurrentGuardianSetIndex();
    if (currGuardianSetIndex != guardianSetIndex) {
        await provider.send("anvil_setStorageAt", [
            coreBridge.address,
            ethers.utils.hexZeroPad("0x3", 32),
            ethers.utils.hexZeroPad("0x0", 32),
        ]);
    }

    // get slot for Guardian Set at the current index
    const guardianSetSlot = ethers.utils.keccak256(
        abiCoder.encode(["uint32", "uint256"], [guardianSetIndex, 2]),
    );

    // Overwrite all but first guardian set to zero address. This isn't
    // necessary, but just in case we inadvertently access these slots
    // for any reason.
    const numGuardians = await provider
        .getStorageAt(coreBridge.address, guardianSetSlot)
        .then((value) => ethers.BigNumber.from(value).toBigInt());
    for (let i = 1; i < numGuardians; ++i) {
        await provider.send("anvil_setStorageAt", [
            coreBridge.address,
            abiCoder.encode(
                ["uint256"],
                [ethers.BigNumber.from(ethers.utils.keccak256(guardianSetSlot)).add(i)],
            ),
            ethers.utils.hexZeroPad("0x0", 32),
        ]);
    }

    // Now overwrite the first guardian key with the devnet key specified
    // in the function argument.
    const devnetGuardian = new ethers.Wallet(GUARDIAN_PRIVATE_KEY).address;
    await provider.send("anvil_setStorageAt", [
        coreBridge.address,
        abiCoder.encode(
            ["uint256"],
            [
                ethers.BigNumber.from(ethers.utils.keccak256(guardianSetSlot)).add(
                    0, // just explicit w/ index 0
                ),
            ],
        ),
        ethers.utils.hexZeroPad(devnetGuardian, 32),
    ]);

    // change the length to 1 guardian
    await provider.send("anvil_setStorageAt", [
        coreBridge.address,
        guardianSetSlot,
        ethers.utils.hexZeroPad("0x1", 32),
    ]);

    // Confirm guardian set override
    const guardians = await coreBridge.getGuardianSet(guardianSetIndex).then(
        (guardianSet: any) => guardianSet[0], // first element is array of keys
    );
    assert(
        guardianSetIndex == (await coreBridge.getCurrentGuardianSetIndex()),
        "Guardian set index should be set",
    );
    assert(guardians.length === 1, "Guardian set length should be 1");
    assert(guardians[0] === devnetGuardian, "Guardian set should be devnet key");
}

export async function overrideCircleAnvil(chain: Chain): Promise<void> {
    let { provider, messageTransmitter } = await circleContract(chain);

    // fetch attestation manager address
    const attesterManager = await messageTransmitter.attesterManager();
    const myAttester = new ethers.Wallet(GUARDIAN_PRIVATE_KEY, provider);

    // start prank (impersonate the attesterManager)
    await provider.send("anvil_impersonateAccount", [attesterManager]);
    await provider.send("anvil_setBalance", [
        attesterManager,
        ethers.BigNumber.from("1000000000000000000")._hex,
    ]);

    // update the number of required attestations to one
    messageTransmitter = messageTransmitter.connect(provider.getSigner(attesterManager));
    await messageTransmitter.setSignatureThreshold(ethers.BigNumber.from("1"));

    // enable devnet guardian as attester
    await messageTransmitter.enableAttester(myAttester.address);

    // stop prank
    await provider.send("anvil_stopImpersonatingAccount", [attesterManager]);

    // fetch number of attesters
    const numAttesters = await messageTransmitter.getNumEnabledAttesters();

    // confirm that the attester address swap was successful
    const attester = await messageTransmitter.getEnabledAttester(
        numAttesters.sub(ethers.BigNumber.from("1")),
    );

    assert(attester === myAttester.address, "Attester address should be devnet key");
}

export async function mintUsdcForTest(chain: Chain, mintAmount: string): Promise<void> {
    let { provider, wallet, contract: usdc } = await usdcContract(chain);

    // fetch master minter address
    const masterMinter = await usdc.masterMinter();

    // start prank (impersonate the Circle masterMinter)
    await provider.send("anvil_impersonateAccount", [masterMinter]);
    await provider.send("anvil_setBalance", [
        masterMinter,
        ethers.BigNumber.from("1000000000000000000")._hex,
    ]);

    // configure the wallet as a minter
    {
        usdc = usdc.connect(provider.getSigner(masterMinter));
        await usdc.configureMinter(wallet.address, ethers.constants.MaxUint256);
    }

    // stop prank
    await provider.send("anvil_stopImpersonatingAccount", [masterMinter]);

    // mint USDC and confirm with a balance check
    {
        const amount = ethers.utils.parseUnits(mintAmount, 6);

        const balanceBefore = await usdc.balanceOf(wallet.address);

        usdc = usdc.connect(wallet);
        await usdc.mint(wallet.address, amount).then((tx) => tx.wait());

        const balanceAfter = await usdc.balanceOf(wallet.address);
        assert(balanceAfter.sub(balanceBefore).eq(amount), "USDC minting failed");
    }
}
