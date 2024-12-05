#!/bin/bash

while getopts ":c:r:k:" opt; do
  case $opt in
    c) chain="$OPTARG"
    ;;
    r) rpc="$OPTARG"
    ;;
    k) private_key="$OPTARG"
    ;;
    \?) echo "Invalid option -$OPTARG" >&2
    exit 1
    ;;
  esac

  case $OPTARG in
    -*) echo "Option $opt needs a valid argument" >&2
    exit 1
    ;;
  esac
done

if [ -z ${rpc+x} ];
then
    echo "rpc (-r) is unset" >&2
    exit 1
fi

if [ -z ${chain+x} ];
then
    echo "chain (-c) is unset" >&2
    exit 1
fi

if [ -z ${private_key+x} ];
then
    echo "private key (-k) is unset" >&2
    exit 1
fi

set -euo pipefail

ROOT=$(dirname $0)
FORGE_SCRIPTS=$ROOT/../forge-scripts

export RELEASE_WORMHOLE_CHAIN_ID=$chain

forge script $FORGE_SCRIPTS/DeploySwapLayer.s.sol \
    --rpc-url $rpc \
    --broadcast \
    --private-key $private_key \
    --slow \
    --skip test