import * as fs from "fs";

main();

async function main() {
    fs.readdirSync("collected").forEach((fn) => {
        const address = fn.slice(0, -5);
        console.log(`
### TODO
[[test.validator.account]]
address = "${address}"
filename = "collected/${address}.json"`);
    });
}
