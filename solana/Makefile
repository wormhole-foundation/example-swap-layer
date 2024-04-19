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

.PHONY: cargo-test
cargo-test:
	cargo test --workspace --all-targets --features $(NETWORK) -- --nocapture

.PHONY: integration-test
integration-test: node_modules ../lib/example-liquidity-layer/solana/node_modules
	mkdir -p ts/tests/artifacts
	solana program dump -u m worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth ts/tests/artifacts/mainnet_core_bridge.so
	solana program dump -u m CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3 ts/tests/artifacts/mainnet_cctp_token_messenger_minter.so
	solana program dump -u m CCTPmbSD7gX1bxKPAmg77w8oFzNFpaQiQUWD43TKaecd ts/tests/artifacts/mainnet_cctp_message_transmitter.so
	solana program dump -u m JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4 ts/tests/artifacts/mainnet_jupiter_v6.so
	solana program dump -u m whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc ts/tests/artifacts/mainnet_whirlpool.so
	anchor test --arch sbf -- --features integration-test

../lib/example-liquidity-layer/solana/node_modules:
	cd .. && $(MAKE) lib/example-liquidity-layer/solana/node_modules

.PHONY: test
test:
	NETWORK=localnet $(MAKE) cargo-test
	NETWORK=testnet $(MAKE) cargo-test