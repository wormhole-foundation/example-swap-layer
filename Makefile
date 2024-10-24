
.PHONY: build
build: node_modules
	cd evm && $(MAKE)
	cd solana && $(MAKE) && $(MAKE) anchor-build-idl
	npm run build

.PHONY: clean
clean: fast-transfer-clean
	rm -rf e2e/node_modules
	cd evm && $(MAKE) clean
	cd solana && $(MAKE) clean
	npm run clean
	rm -rf node_modules

.PHONY: fast-transfer-sync
fast-transfer-sync:
	git submodule update --init --checkout --recursive
	git submodule sync --recursive

.PHONY: fast-transfer-clean
fast-transfer-clean:
	rm -rf lib/example-liquidity-layer
	$(MAKE) fast-transfer-sync

.PHONY: fast-transfer-setup
fast-transfer-setup: fast-transfer-sync
	cd lib/example-liquidity-layer/solana && $(MAKE) anchor-test-setup
	cd lib/example-liquidity-layer/evm && $(MAKE) build

.PHONY: fast-transfer-sdk
fast-transfer-sdk: fast-transfer-setup
	cd lib/example-liquidity-layer \
	&& $(MAKE) build \
	&& npm run build -w solana -w evm \
	&& npm pack -w universal/ts -w solana -w evm

node_modules: fast-transfer-sdk
	npm install -w solana lib/example-liquidity-layer/wormhole-foundation-example-liquidity-layer-*
	npm install -w e2e lib/example-liquidity-layer/wormhole-foundation-example-liquidity-layer-*
	npm ci
