
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

node_modules:
	npm ci
