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

tolib = $(addprefix lib/,$(firstword $(subst @, ,$(notdir $(1)))))

define install_lib
dependencies: $(call tolib,$(1))

$(call tolib,$(1)):
	forge install $(1) --no-git --no-commit
endef

.DEFAULT_GOAL = build
.PHONY: build test clean dependencies

build: dependencies
	forge build

test: dependencies
	forge test --fork-url $$TEST_RPC -vvv
#--match-test InitiateFullFuzz

LIB_DEPS = foundry-rs/forge-std
LIB_DEPS += openzeppelin/openzeppelin-contracts@dc44c9f #4.9.6
LIB_DEPS += Uniswap/permit2@cc56ad0 #latest commit as per 22/04/2024
LIB_DEPS += wormhole-foundation/wormhole-solidity-sdk@60fb760 #post-merged branch
LIB_DEPS += wormhole-foundation/example-liquidity-layer@f57444f #main branch

# dynamically generate install rule for each lib dependency and add to depdenencies
$(foreach dep,$(LIB_DEPS), $(eval $(call install_lib,$(dep))))

clean:
	forge clean
	rm -rf lib
	rm -rf node_modules
	@$(MAKE) -C env clean
