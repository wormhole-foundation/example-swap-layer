#the chain that will be forked for testing
TEST_FORK = Mainnet Ethereum

#include (and build if necessary) env/testing.env if we're running tests
ifneq (,$(filter test, $(MAKECMDGOALS)))
#hacky:
_ := $(shell $(MAKE) -C env build NETWORK=$(word 1,${TEST_FORK}) CHAIN=$(word 2,${TEST_FORK}))
include env/testing.env
export
unexport TEST_FORK
endif

.DEFAULT_GOAL = build
.PHONY: build test clean dependencies

build: dependencies
	forge build

test: dependencies
	forge test --fork-url $$TEST_RPC -vvv
#--match-test RelayedEthSwap

clean:
	forge clean
	@$(MAKE) -C env clean

dependencies: lib/forge-std lib/openzeppelin-contracts lib/wormhole-solidity-sdk

#TODO nail down version
lib/forge-std:
	forge install foundry-rs/forge-std --no-git --no-commit

#TODO nail down version
lib/openzeppelin-contracts:
	forge install openzeppelin/openzeppelin-contracts --no-git --no-commit

lib/wormhole-solidity-sdk:
	forge install wormhole-foundation/wormhole-solidity-sdk@18894be --no-git --no-commit
