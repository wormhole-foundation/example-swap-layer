import { ethers } from "ethers";
const elliptic = require("elliptic");

export function doubleKeccak256(body: ethers.BytesLike) {
  return ethers.utils.keccak256(ethers.utils.keccak256(body));
}

export function zeroPadBytes(value: string, length: number): string {
  while (value.length < 2 * length) {
    value = "0" + value;
  }
  return value;
}
