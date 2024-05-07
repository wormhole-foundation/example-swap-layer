import { expect } from "chai";

export function hackedExpectDeepEqual(left: any, right: any) {
    expect(JSON.parse(JSON.stringify(left))).to.eql(JSON.parse(JSON.stringify(right)));
}
