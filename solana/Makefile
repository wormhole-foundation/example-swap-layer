.PHONY: all
all: check

.PHONY: check
check:
	cargo check --workspace --all-targets --all-features

.PHONY: clean
clean:
	anchor clean
	rm -rf node_modules artifacts-mainnet artifacts-testnet artifacts-localnet ts/tests/artifacts

node_modules: package-lock.json ../lib/example-liquidity-layer/solana/node_modules
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

CLONED_PROGRAMS=\
	ts/tests/artifacts/mainnet_core_bridge.so \
	ts/tests/artifacts/mainnet_cctp_token_messenger_minter.so \
	ts/tests/artifacts/mainnet_cctp_message_transmitter.so \
	ts/tests/artifacts/mainnet_jupiter_v6.so \
	ts/tests/artifacts/mainnet_whirlpool.so

.PHONY: integration-test
integration-test: node_modules $(CLONED_PROGRAMS) ../lib/example-liquidity-layer/solana/artifacts-localnet
	anchor test --arch sbf -- --features integration-test 

../lib/example-liquidity-layer/solana/node_modules:
	cd ../lib/example-liquidity-layer/solana && $(MAKE) node_modules

.PHONY: test
test:
	NETWORK=localnet $(MAKE) cargo-test
	NETWORK=testnet $(MAKE) cargo-test

ts/tests/artifacts:
	mkdir ts/tests/artifacts

ts/tests/artifacts/mainnet_core_bridge.so: ts/tests/artifacts
	solana program dump -u m worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth ts/tests/artifacts/mainnet_core_bridge.so

ts/tests/artifacts/mainnet_cctp_token_messenger_minter.so: ts/tests/artifacts
	solana program dump -u m CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3 ts/tests/artifacts/mainnet_cctp_token_messenger_minter.so

ts/tests/artifacts/mainnet_cctp_message_transmitter.so: ts/tests/artifacts
	solana program dump -u m CCTPmbSD7gX1bxKPAmg77w8oFzNFpaQiQUWD43TKaecd ts/tests/artifacts/mainnet_cctp_message_transmitter.so

ts/tests/artifacts/mainnet_jupiter_v6.so: ts/tests/artifacts
	solana program dump -u m JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4 ts/tests/artifacts/mainnet_jupiter_v6.so

ts/tests/artifacts/mainnet_whirlpool.so: ts/tests/artifacts
	solana program dump -u m whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc ts/tests/artifacts/mainnet_whirlpool.so

../lib/example-liquidity-layer/solana/artifacts-localnet:
	cd ../lib/example-liquidity-layer/solana && NETWORK=localnet $(MAKE) build