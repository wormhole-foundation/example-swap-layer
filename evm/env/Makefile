.PHONY: build clean FORCE

ifndef NETWORK
  $(info No NETWORK specified, defaulting to Mainnet)
  NETWORK = Mainnet
endif

ifndef CHAIN
  $(error No CHAIN specified)
endif

FORK = $(NETWORK) $(CHAIN)

build: node_modules testing.env

clean:
	rm -rf node_modules fork_changed testing.env

FORCE:

ifneq ($(FORK), $(shell cat fork_changed 2>/dev/null))
#if a different chain/network was supplied last time then force an update
fork_changed: FORCE
endif
fork_changed:
	@echo $(FORK) > fork_changed

node_modules:
	npm ci

testing.env: fork_changed ../ts-sdk/lib
	npm run build -- $(FORK)

../ts-sdk/lib:
	cd ../ts-sdk && npm ci && npm run build
