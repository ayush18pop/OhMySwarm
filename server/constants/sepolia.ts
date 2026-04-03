export const SEPOLIA_CHAIN_ID = 11155111;

export const USDC_ADDRESS =
  "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" as `0x${string}`;

export const AAVE_V3_POOL_ADDRESS =
  "0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951" as `0x${string}`;

export const USDC_DECIMALS = 6;

export const ERC20_ABI = [
  {
    name: "transfer",
    type: "function",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    name: "approve",
    type: "function",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    name: "balanceOf",
    type: "function",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
] as const;

export const AAVE_V3_POOL_ABI = [
  {
    name: "supply",
    type: "function",
    inputs: [
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "onBehalfOf", type: "address" },
      { name: "referralCode", type: "uint16" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

export function toUsdcUnits(amount: number | string): bigint {
  const parsed = Number.parseFloat(String(amount));
  if (Number.isNaN(parsed)) return 0n;
  return BigInt(Math.round(parsed * 10 ** USDC_DECIMALS));
}
