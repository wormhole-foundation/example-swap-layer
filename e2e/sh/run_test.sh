#/bin/bash

ROOT=$(realpath $(dirname $0)/../..)

rm -f Anchor.toml

sed 's/\= "ts\//\= "..\/solana\/ts\//' $ROOT/solana/Anchor.toml > Anchor.toml
sed -E -i 's/"programs\/swap-layer"/"..\/solana\/programs\/swap-layer"/' Anchor.toml
sed -E -i 's/^test \= ".+"/test = "npx ts-mocha -p .\/tsconfig.anchor-test.json -t 1000000 --bail --exit tests\/[0-9]*.ts"/' Anchor.toml

mkdir -p target/deploy

# start anvil in the evm directory
cd $ROOT/evm
bash test/script/start_anvil.sh

echo "Anvil instances started successfully."

cd $ROOT/solana
make anchor-test-setup
anchor build -- --features integration-test
cp target/deploy/swap_layer.so $ROOT/e2e/target/deploy

cd $ROOT/e2e

anchor test --skip-build

pkill anvil
