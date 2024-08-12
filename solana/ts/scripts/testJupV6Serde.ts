import { decodeSharedAccountsRouteArgs } from "../src/jupiterV6";

main();

function main() {
    const samples = [
        "wSCbM0HWnIEFAQAAABEAZAABAHQ7pAsAAABoSiqlCwAAADIAAA==", // recent
        "wSCbM0HWnIEAAQAAABEBZAABAHQ7pAsAAACbnbOiCwAAADIAAA==", // a.json
        "wSCbM0HWnIEAAQAAABEAZAABAHQ7pAsAAAB29CSlCwAAADIAAA==", // b.json
        "wSCbM0HWnIECAQAAABEAZAABAHQ7pAsAAAAoYEulCwAAADIAAA==", // og
    ];

    for (const sample of samples) {
        const data = Buffer.from(sample, "base64");
        console.log({ data });

        const wtf = decodeSharedAccountsRouteArgs(data);

        console.log({ wtf });
        console.log(wtf.routePlan);
        console.log();
    }
}
