#!/bin/bash
while getopts ":c:r:k:a:" opt; do
  case $opt in
    c) chain="$OPTARG"
    ;;
    r) rpc="$OPTARG"
    ;;
    k) private_key="$OPTARG"
    ;;
    a) action="$OPTARG"
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

# Validate required parameters
if [ -z ${rpc+x} ]; then
    echo "rpc (-r) is unset" >&2
    exit 1
fi
if [ -z ${chain+x} ]; then
    echo "chain (-c) is unset" >&2
    exit 1
fi
if [ -z ${private_key+x} ]; then
    echo "private key (-k) is unset" >&2
    exit 1
fi
# Set default action to deploy if not specified
if [ -z ${action+x} ]; then
    action="deploy"
fi

# Validate action parameter
# Validate action if specified
if [ "$action" != "deploy" ] && [ "$action" != "configure" ] && [ "$action" != "validate" ]; then
    echo "action (-a) if specified must be one of: 'deploy', 'configure', or 'validate'" >&2
    exit 1
fi

set -euo pipefail
ROOT=$(dirname $0)
FORGE_SCRIPTS=$ROOT/../forge-scripts
export RELEASE_WORMHOLE_CHAIN_ID=$chain

# Determine which script to run based on action
if [ "$action" = "deploy" ]; then
    SCRIPT_NAME="DeploySwapLayer.s.sol"
elif [ "$action" = "configure" ]; then
    SCRIPT_NAME="ConfigureSwapLayer.s.sol"
else
    SCRIPT_NAME="ValidateSwapLayer.s.sol"
fi

forge script $FORGE_SCRIPTS/$SCRIPT_NAME \
    --rpc-url $rpc \
    --broadcast \
    --private-key $private_key \
    --slow \
    --skip test