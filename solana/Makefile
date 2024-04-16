.PHONY: all
all: check

.PHONY: check
check:
	cargo check --workspace --all-targets --all-features

.PHONY: clean
clean:
	anchor clean
	rm -rf node_modules artifacts-mainnet artifacts-testnet artifacts-localnet ts/tests/artifacts

node_modules: package-lock.json
	npm ci

.PHONY: clippy
clippy:
	cargo clippy --workspace --no-deps --all-targets --all-features -- -Dwarnings

.PHONY: lint
lint:
	cargo fmt --check
	$(MAKE) clippy

lib/example-liquidity-layer/solana/Cargo.toml:
	git submodule update --init --recursive

.PHONY: integration-test
integration-test: node_modules lib/example-liquidity-layer/solana/Cargo.toml
	anchor test --arch sbf -- --features integration-test