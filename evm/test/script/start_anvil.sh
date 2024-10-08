#/bin/bash

pgrep anvil > /dev/null
if [ $? -eq 0 ]; then
    echo "anvil already running"
    exit 1;
fi

ROOT=$(dirname $0)
ENV=$ROOT/../../env/localnet

OWNER_PRIVATE_KEY=0x646f1ce2fdad0e6deeeb5c7e8e5543bdde65e86029e2fd9fc169899c440a7913

. $ENV/Ethereum.env

# Ethereum (CCTP).
anvil --port 8548 \
    -m "myth like bonus scare over problem client lizard pioneer submit female collect" \
    --fork-url $RELEASE_RPC \
    --fork-block-number 20034932 \
    > /dev/null &

sleep 2

forge script $ROOT/DeploySwapLayerForTest.s.sol \
    --rpc-url http://localhost:8548 \
    --broadcast \
    --private-key $OWNER_PRIVATE_KEY

. $ENV/Base.env

# Base (CCTP).
anvil --port 8549 \
    -m "myth like bonus scare over problem client lizard pioneer submit female collect" \
    --fork-url $RELEASE_RPC \
    --fork-block-number 15456753 \
    > /dev/null &

sleep 2

forge script $ROOT/DeploySwapLayerForTest.s.sol \
    --rpc-url http://localhost:8549 \
    --broadcast \
    --private-key $OWNER_PRIVATE_KEY

# Double-check number of anvil instances.
if [ "$( pgrep anvil | wc -l )" -ne 2 ]; then
    echo "Not all anvil instances are running. Try again."
    pkill anvil
    exit 1
fi