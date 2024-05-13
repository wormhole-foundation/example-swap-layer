.PHONY: clean
clean:
	$(MAKE) fast-transfer-clean
	rm -rf node_modules

.PHONY: fast-transfer-sync
fast-transfer-sync:
	git submodule update --init
	git submodule sync --recursive

.PHONY: fast-transfer-clean
fast-transfer-clean: fast-transfer-sync
	cd lib/example-liquidity-layer/solana && $(MAKE) clean

.PHONY: fast-transfer-setup
fast-transfer-setup: fast-transfer-sync
	cd lib/example-liquidity-layer/solana && $(MAKE) anchor-test-setup

.PHONY: fast-transfer-sdk
fast-transfer-sdk: fast-transfer-setup
	cd lib/example-liquidity-layer && npm ci && npm run build --workspace solana && npm pack --workspace solana 

node_modules: fast-transfer-sdk
	npm update @wormhole-foundation/example-liquidity-layer-solana 
	npm ci
