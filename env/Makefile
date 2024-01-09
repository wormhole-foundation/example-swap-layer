.PHONY: build clean

ifndef NETWORK
  $(info No NETWORK specified, defaulting to Mainnet)
  NETWORK = Mainnet
endif

ifndef CHAIN
  $(error No CHAIN specified)
endif

FORK = $(NETWORK) $(CHAIN)

build: node_modules fork_changed
	npm run build -- $(FORK)

clean:
	rm -rf node_modules fork_changed testing.env

ifneq ($(FORK), $(shell cat fork_changed 2>/dev/null))
#if a different chain/network was supplied last time then force an update
.PHONY: fork_changed
endif
fork_changed:
	@echo $(FORK) > fork_changed

node_modules:
	npm ci
