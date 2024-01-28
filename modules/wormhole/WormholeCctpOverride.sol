// SPDX-License-Identifier: Apache 2
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";

import "cctp/ITokenMessenger.sol";

import {IWormhole} from "wormhole-sdk/interfaces/IWormhole.sol";
import {BytesParsing} from "wormhole-sdk/libraries/BytesParsing.sol";
import {toUniversalAddress} from "wormhole-sdk/Utils.sol";

import {WormholeCctpMessages} from "./WormholeCctpMessages.sol";
import {WormholeOverride} from "./WormholeOverride.sol";

//Message format emitted by Circle MessageTransmitter - akin to Wormhole CoreBridge
//  see: https://github.com/circlefin/evm-cctp-contracts/blob/master/src/messages/Message.sol
//
//Unlike the Wormhole CoreBridge which broadcasts, Circle Messages always have an intended
//  destination and recipient.
//
//Cctp messages are "redeemed" by calling receiveMessage() on the Circle Message Transmitter
//  which in turn invokes handleReceiveMessage() on the recipient of the message:
//  see: https://github.com/circlefin/evm-cctp-contracts/blob/adb2a382b09ea574f4d18d8af5b6706e8ed9b8f2/src/MessageTransmitter.sol#L294-L295
//So even messages that originate from the TokenMessenger are first sent to the MessageTransmitter
//  whereas Wormhole TokenBridge messages must be redeemed with the TokenBridge, which internally
//  verifies the veracity of the VAA with the CoreBridge.
//To provide a similar restriction like the TokenBridge's redeemWithPayload() function which can
//  only be called by the recipient of the TokenBridge transferWithPayload message, Circle provides
//  an additional, optional field named destinationCaller which must be the caller of
//  receiveMessage() when it has been specified (i.e. the field is != 0).
struct CctpHeader {
  //uint32 headerVersion;
  uint32 sourceDomain;
  uint32 destinationDomain;
  uint64 nonce;
  //caller of the Circle Message Transmitter -> for us always the foreign TokenMessenger
  bytes32 sender;
  //caller of the Circle Message Transmitter -> for us always the local TokenMessenger
  bytes32 recipient;
  bytes32 destinationCaller;
}

struct CctpTokenBurnMessage {
  CctpHeader header;
  //uint32 bodyVersion;
  //the address of the USDC contract on the foreign domain whose tokens were burned
  bytes32 burnToken;
  //always our local WormholeCctpTokenMessenger contract (e.g. CircleIntegration, TokenRouter)a
  bytes32 mintRecipient;
  uint256 amount;
  //address of caller of depositAndBurn on the foreign chain - for us always foreignCaller
  bytes32 messageSender;
}

//faked foreign call chain:
//  foreignCaller -> foreignSender -> FOREIGN_TOKEN_MESSENGER -> foreign MessageTransmitter
//example:
//  foreignCaller = swap layer
//  foreignSender = liquidity layer - implements WormholeCctpTokenMessenger
//                     emits WormholeCctpMessages.Deposit VAA with a RedeemFill payload

//local call chain using faked vaa and circle attestation:
//  test -> intermediate contract(s) -> mintRecipient -> MessageTransmitter -> TokenMessenger
//example:
//  intermediate contract = swap layer
//  mintRecipient = liquidity layer

//using values that are easily recognizable in an encoded payload
uint32  constant FOREIGN_DOMAIN = 0xDDDDDDDD;
bytes32 constant FOREIGN_TOKEN_MESSENGER =
  0xEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE;
bytes32 constant FOREIGN_USDC =
  0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC;

contract WormholeCctpOverride {
  using WormholeOverride for IWormhole;
  using BytesParsing for bytes;
  using WormholeCctpMessages for bytes32;
  using { toUniversalAddress } for address;

  error NoLogsFound();

  Vm constant vm = Vm(address(bytes20(uint160(uint256(keccak256("hevm cheat code"))))));

  IWormhole           immutable wormhole;
  IMessageTransmitter immutable messageTransmitter;
  ITokenMessenger     immutable tokenMessenger;
  uint16              immutable foreignChain;
  uint256             immutable attesterPrivateKey;

  uint64 foreignNonce;
  uint64 foreignSequence;
  bytes32 foreignCaller; //address that calls foreignSender to burn their tokens and emit a message
  bytes32 foreignSender; //address that sends tokens by calling TokenMessenger.depositForBurn
  address mintRecipient; //recipient of cctp messages
  address destinationCaller; //by default mintRecipient

  constructor(
    IWormhole wormhole_,
    address tokenMessenger_,
    uint16 foreignChain_,
    bytes32 foreignSender_, //contract that invokes the core bridge and calls depositForBurn
    address mintRecipient_,
    address usdc
  ) {
    wormhole = wormhole_;
    tokenMessenger = ITokenMessenger(tokenMessenger_);
    foreignChain = foreignChain_;
    foreignSender = foreignSender_;
    mintRecipient = mintRecipient_;
    destinationCaller = mintRecipient;
    messageTransmitter = tokenMessenger.localMessageTransmitter();
    attesterPrivateKey = wormhole.guardianPrivateKey();
    require(attesterPrivateKey != 0, "setup wormhole override first");

    foreignNonce    = 0xBBBBBBBBBBBBBBBB;
    foreignSequence = 0xAAAAAAAAAAAAAAAA;
    //default value - can be overridden if desired
    foreignCaller = 0xCA11E2000CA11E200CA11E200CA11E200CA11E200CA11E200CA11E2000CA11E2;

    // enable the guardian key as an attester
    vm.startPrank(messageTransmitter.attesterManager());

    // set the signature threshold to 1
    messageTransmitter.setSignatureThreshold(1);

    // enable our key as the attester
    messageTransmitter.enableAttester(vm.addr(attesterPrivateKey));

    vm.stopPrank();

    //register our fake foreign circle token messenger
    vm.prank(tokenMessenger.owner());
    tokenMessenger.addRemoteTokenMessenger(FOREIGN_DOMAIN, FOREIGN_TOKEN_MESSENGER);

    //register our fake foreign usdc
    //  The Circle TokenMessenger has been implemented in a way that supports multiple tokens
    //    so we have to establish the link between our fake foreign USDC with the actual local
    //    USDC.
    ITokenMinter localMinter = tokenMessenger.localMinter();
    vm.prank(localMinter.tokenController());
    localMinter.linkTokenPair(usdc, FOREIGN_DOMAIN, FOREIGN_USDC);
  }

  //to reduce boilerplate, we use setters to avoid arguments that are likely the same
  function setMintRecipient(address mintRecipient_) external {
    mintRecipient = mintRecipient_;
  }

  //setting address(0) disables the check in MessageTransmitter
  function setDestinationCaller(address destinationCaller_) external {
    destinationCaller = destinationCaller_;
  }

  function setForeignCaller(bytes32 foreignCaller_) external {
    foreignCaller = foreignCaller_;
  }

  function setForeignSender(bytes32 foreignSender_) external {
    foreignSender = foreignSender_;
  }

  //for creating "pure" cctp transfers (no associated Wormhole vaa)
  function craftCctpCctpTokenBurnMessage(
    uint256 amount
  ) external returns (
    bytes memory encodedCctpMessage,
    bytes memory cctpAttestation
  ) {
    (, encodedCctpMessage, cctpAttestation) = _craftCctpCctpTokenBurnMessage(amount);
  }

  //for creating cctp + associated vaa transfers
  function craftWormholeCctpRedeemParams(
    uint256 amount,
    bytes memory payload
  ) external returns (
    bytes memory encodedVaa,
    bytes memory encodedCctpMessage,
    bytes memory cctpAttestation
  ) {
    CctpTokenBurnMessage memory burnMsg;
    (burnMsg, encodedCctpMessage, cctpAttestation) = _craftCctpCctpTokenBurnMessage(amount);

    //craft the associated VAA
    (, encodedVaa) = wormhole.craftVaa(
      foreignChain,
      foreignSender,
      foreignSequence++,
      burnMsg.burnToken.encodeDeposit(
        amount,
        burnMsg.header.sourceDomain,
        burnMsg.header.destinationDomain,
        burnMsg.header.nonce,
        foreignCaller,
        burnMsg.mintRecipient,
        payload
      )
    );
  }

  function _craftCctpCctpTokenBurnMessage(
    uint256 amount
  ) internal returns (
    CctpTokenBurnMessage memory burnMsg,
    bytes memory encodedCctpMessage,
    bytes memory cctpAttestation
  ) {
    //compose the cctp burn msg
    burnMsg.header.sourceDomain      = FOREIGN_DOMAIN;
    burnMsg.header.destinationDomain = messageTransmitter.localDomain();
    burnMsg.header.nonce             = foreignNonce++;
    burnMsg.header.sender            = FOREIGN_TOKEN_MESSENGER;
    burnMsg.header.recipient         = address(tokenMessenger).toUniversalAddress();
    burnMsg.header.destinationCaller = destinationCaller.toUniversalAddress();
    burnMsg.burnToken     = FOREIGN_USDC;
    burnMsg.mintRecipient = mintRecipient.toUniversalAddress();
    burnMsg.amount        = amount;
    burnMsg.messageSender = foreignSender;

    //encode and sign it
    encodedCctpMessage = encodeCctpTokenBurnMessage(burnMsg);
    (uint8 v, bytes32 r, bytes32 s) = vm.sign(attesterPrivateKey, keccak256(encodedCctpMessage));
    cctpAttestation = abi.encodePacked(r, s, v);
  }

  function encodeCctpTokenBurnMessage(
    CctpTokenBurnMessage memory burnMsg
  ) public view returns (bytes memory) {
    return abi.encodePacked(
      messageTransmitter.version(),
      burnMsg.header.sourceDomain,
      burnMsg.header.destinationDomain,
      burnMsg.header.nonce,
      burnMsg.header.sender,
      burnMsg.header.recipient,
      burnMsg.header.destinationCaller,
      tokenMessenger.messageBodyVersion(),
      burnMsg.burnToken,
      burnMsg.mintRecipient,
      burnMsg.amount,
      burnMsg.messageSender
    );
  }

  function decodeCctpTokenBurnMessage(
    bytes memory encoded
  ) public view returns (CctpTokenBurnMessage memory ret) { unchecked {
      uint offset;
      uint32 version;
      (version,                      offset) = encoded.asUint32Unchecked(offset);
      require(version == messageTransmitter.version(), "cctp msg header version mismatch");
      (ret.header.sourceDomain,      offset) = encoded.asUint32Unchecked(offset);
      (ret.header.destinationDomain, offset) = encoded.asUint32Unchecked(offset);
      (ret.header.nonce,             offset) = encoded.asUint64Unchecked(offset);
      (ret.header.sender,            offset) = encoded.asBytes32Unchecked(offset);
      (ret.header.recipient,         offset) = encoded.asBytes32Unchecked(offset);
      (ret.header.destinationCaller, offset) = encoded.asBytes32Unchecked(offset);
      (version,                      offset) = encoded.asUint32Unchecked(offset);
      require(version == tokenMessenger.messageBodyVersion(), "cctp msg body version mismatch");
      (ret.burnToken,                offset) = encoded.asBytes32Unchecked(offset);
      (ret.mintRecipient,            offset) = encoded.asBytes32Unchecked(offset);
      (ret.amount,                   offset) = encoded.asUint256Unchecked(offset);
      (ret.messageSender,            offset) = encoded.asBytes32Unchecked(offset);
      encoded.checkLength(offset);
      return ret;
  }}

  function fetchCctpTokenBurnMessage(
    Vm.Log[] memory logs
  ) external view returns (CctpTokenBurnMessage[] memory cctpTokenBurnMessages) { unchecked {
    if (logs.length == 0)
      revert NoLogsFound();

    bytes32 topic = keccak256("MessageSent(bytes)");

    uint256 count;
    uint256 n = logs.length;
    for (uint256 i; i < n; ++i)
      if (logs[i].topics[0] == topic)
        ++count;

    // create log array to save published messages
    cctpTokenBurnMessages = new CctpTokenBurnMessage[](count);

    uint256 publishedIndex;
    for (uint256 i; i < n; ++i)
      if (logs[i].topics[0] == topic)
        cctpTokenBurnMessages[publishedIndex++] =
          decodeCctpTokenBurnMessage(abi.decode(logs[i].data, (bytes)));
  }}
}
