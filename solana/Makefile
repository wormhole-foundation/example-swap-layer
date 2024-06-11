CLONED_PROGRAMS=\
	ts/tests/artifacts/mainnet_core_bridge.so \
	ts/tests/artifacts/mainnet_cctp_token_messenger_minter.so \
	ts/tests/artifacts/mainnet_cctp_message_transmitter.so \
	ts/tests/artifacts/mainnet_jupiter_v6.so \
	ts/tests/artifacts/mainnet_whirlpool.so \
	ts/tests/artifacts/mainnet_phoenix_v1.so \
	ts/tests/artifacts/mainnet_meteora_dlmm.so \
	ts/tests/artifacts/mainnet_crema.so \
	ts/tests/artifacts/mainnet_fluxbeam.so \
	ts/tests/artifacts/mainnet_raydium_clmm.so

.PHONY: all
all: check

.PHONY: check
check:
	cargo check --workspace --all-targets --all-features

.PHONY: clean
clean:
	anchor clean
	rm -rf node_modules artifacts-mainnet artifacts-testnet artifacts-localnet ts/tests/artifacts

.PHONY: fast-transfer-sync
fast-transfer-sync:
	cd .. && $(MAKE) fast-transfer-sync

../node_modules:
	cd .. && $(MAKE) node_modules

.PHONY: clippy
clippy:
	cargo clippy --workspace --no-deps --all-targets --all-features -- -Dwarnings

.PHONY: lint
lint: fast-transfer-sync
	cargo fmt --check
	$(MAKE) clippy

.PHONY: cargo-test
cargo-test: fast-transfer-sync
	cargo test --workspace --all-targets --features $(NETWORK)

.PHONY: anchor-test
anchor-test: anchor-test-setup
	anchor test -- --features integration-test

.PHONY: anchor-test-setup
anchor-test-setup: ../node_modules $(CLONED_PROGRAMS)

.PHONY: anchor-build-idl
anchor-build-idl:
	anchor build -- --features localnet

.PHONY: cargo-test-all
cargo-test-all:
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

ts/tests/artifacts/mainnet_phoenix_v1.so: ts/tests/artifacts
	solana program dump -u m PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY ts/tests/artifacts/mainnet_phoenix_v1.so

ts/tests/artifacts/mainnet_meteora_dlmm.so: ts/tests/artifacts
	solana program dump -u m LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo ts/tests/artifacts/mainnet_meteora_dlmm.so

ts/tests/artifacts/mainnet_crema.so: ts/tests/artifacts
	solana program dump -u m CLMM9tUoggJu2wagPkkqs9eFG4BWhVBZWkP1qv3Sp7tR ts/tests/artifacts/mainnet_crema.so

ts/tests/artifacts/mainnet_fluxbeam.so: ts/tests/artifacts
	solana program dump -u m FLUXubRmkEi2q6K3Y9kBPg9248ggaZVsoSFhtJHSrm1X ts/tests/artifacts/mainnet_fluxbeam.so
	
ts/tests/artifacts/mainnet_raydium_clmm.so: ts/tests/artifacts
	solana program dump -u m CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK ts/tests/artifacts/mainnet_raydium_clmm.so