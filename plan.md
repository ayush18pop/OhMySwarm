# Plan: Real x402 Payments + DeFi Execution on Sepolia

## Context

OhMySwarm currently uses mock USDC transfers everywhere — `payX402` returns fake txHashes even in paid mode, `fundSessionWallet` creates wallets but never moves funds on-chain, and `executorAgent.ts` generates `crypto.randomBytes(32)` for txHashes. The goal is to make all three real on Sepolia testnet using USDC at `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`.

The project already has `viem ^2.21.54` installed, `FUNDING_RPC_URL` set (Alchemy Sepolia), and `encodeUsdcTransfer()` in `wallet.ts` that's unused. The OWS SDK's `signAndSend` is never called anywhere — bypass it entirely, use viem directly.

---

## Step 1 — Create `server/constants/sepolia.ts`

New file. Centralizes all contract addresses and ABIs.

```ts
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
  return BigInt(Math.round(parseFloat(String(amount)) * 10 ** USDC_DECIMALS));
}
```

---

## Step 2 — Prisma Schema: Add `sessionWalletKey`

File: `prisma/schema.prisma`

Add one nullable field to the `Session` model after `sessionWalletAddress`:

```prisma
sessionWalletKey     String?   // AES-256-GCM encrypted private key
```

Run: `npx prisma db push` (or `migrate dev --name add_session_wallet_key`)

---

## Step 3 — Rewrite `server/wallet.ts`

### 3a. New imports (add alongside existing viem imports at top)

```ts
import { createWalletClient, createPublicClient } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { USDC_ADDRESS, ERC20_ABI, toUsdcUnits } from "./constants/sepolia";
import { prisma } from "./db";
```

### 3b. Add AES-256-GCM helpers (new exported functions)

```ts
export function encryptKey(rawHex: string): string; // iv:authTag:ciphertext
export function decryptKey(cipher: string): string;
```

Use `process.env.SESSION_WALLET_ENCRYPTION_KEY` (64-char hex = 32 bytes). If env var absent, store raw with a console warning (testnet acceptable).

### 3c. Rewrite `fundSessionWallet` paid-mode path (lines 221-246)

Replace the entire paid block with:

1. `const privKey = generatePrivateKey()` — viem generates `0x`-prefixed key
2. `const account = privateKeyToAccount(privKey)`
3. `prisma.session.update({ where: { id: sessionId }, data: { sessionWalletKey: encryptKey(privKey), sessionWalletAddress: account.address } })`
4. Build `walletClient` from `TREASURY_PRIVATE_KEY` env var
5. `walletClient.writeContract({ address: USDC_ADDRESS, abi: ERC20_ABI, functionName: 'transfer', args: [account.address, toUsdcUnits(budgetUsdc)] })`
6. `publicClient.waitForTransactionReceipt({ hash })`
7. Return `{ walletName, walletAddress: account.address, txHash }`

### 3d. Rewrite `payX402` paid-mode path (lines 269-287)

Replace mock block with:

1. `prisma.session.findFirst({ where: { sessionWalletName: walletName } })`
2. `decryptKey(session.sessionWalletKey)` → private key
3. `privateKeyToAccount(privKey)` → account + `createWalletClient`
4. `walletClient.writeContract({ address: USDC_ADDRESS, abi: ERC20_ABI, functionName: 'transfer', args: [paymentInfo.address as \`0x\${string}\`, toUsdcUnits(paymentInfo.amount)] })`
5. Wait for receipt, return `{ txHash, amountPaid: amount }`

### 3e. Fix `getWalletAddress` for treasury in paid mode

When `name === TREASURY_WALLET_NAME` and paid mode, derive address from `TREASURY_PRIVATE_KEY`:

```ts
const account = privateKeyToAccount(
  process.env.TREASURY_PRIVATE_KEY as `0x${string}`,
);
return account.address;
```

This makes `GET /api/wallet/treasury` return the real signing address users should fund.

---

## Step 4 — Rewrite `server/subagents/executorAgent.ts`

### 4a. Add imports

```ts
import { createWalletClient, createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import {
  USDC_ADDRESS,
  AAVE_V3_POOL_ADDRESS,
  ERC20_ABI,
  AAVE_V3_POOL_ABI,
  toUsdcUnits,
} from "../constants/sepolia";
import { isPaidModeEnabled, decryptKey } from "../wallet";
```

### 4b. Add `execute_deposit` tool definition (alongside `simulate_deposit`)

Same params as `simulate_deposit`. Description: "Execute a real on-chain deposit via Aave V3 on Sepolia. Use this instead of simulate_deposit when OWS_BILLING_MODE=paid."

### 4c. Implement `executeDeposit(args)` function

Gate: if `!isPaidModeEnabled() || !process.env.TREASURY_PRIVATE_KEY`, fall through to `simulateDeposit(args)`.

Real path:

1. `prisma.session.findFirst({ where: { sessionWalletAddress: args.walletAddress } })`
2. `decryptKey(session.sessionWalletKey)` → privKey
3. Build `walletClient` and `publicClient` with `sepolia` chain + `FUNDING_RPC_URL`
4. `walletClient.writeContract(USDC_ADDRESS, ERC20_ABI, 'approve', [AAVE_V3_POOL_ADDRESS, toUsdcUnits(args.amount)])` → wait receipt
5. `walletClient.writeContract(AAVE_V3_POOL_ADDRESS, AAVE_V3_POOL_ABI, 'supply', [USDC_ADDRESS, toUsdcUnits(args.amount), account.address, 0])` → wait receipt
6. Return `{ status: 'confirmed', txHash: supplyHash, approveTxHash, protocol, token, depositedAmount, chain, walletAddress, blockNumber }`

### 4d. Wire handler: add `execute_deposit: (args) => executeDeposit(args)` to `runExecutor`'s `toolHandlers`

### 4e. Update `EXECUTOR_PROMPT` in `server/agent/prompts.ts`

Append to the executor section:

> "When OWS_BILLING_MODE=paid, use execute_deposit instead of simulate_deposit."

---

## Step 5 — Fix `server/policy.ts`: Add `'sepolia'` to `allowedChains`

Line 51: `allowedChains: ['base-sepolia', 'base', 'ethereum', 'arbitrum', 'sepolia']`

Without this, `check_policy` will deny every Sepolia execution tx.

---

## Step 6 — Add Transak + Faucet Links to `client/src/app/fund/page.tsx`

In the paid-mode block (after line 289, before the closing `</>`), add below the "Confirm Funding" button:

```tsx
{
  /* On-ramp */
}
<div className="border-t border-border pt-4 space-y-3">
  <p className="text-muted text-[10px] uppercase tracking-widest">Quick Fund</p>
  <a
    href={`https://global.transak.com/?network=ethereum&cryptoCurrencyCode=USDC&walletAddress=${treasury?.address}&environment=STAGING`}
    target="_blank"
    rel="noopener noreferrer"
    className="block w-full text-center py-2.5 text-xs rounded border border-cyan/50 text-cyan hover:bg-cyan/10 transition-all"
  >
    Buy USDC via Transak →
  </a>
  {treasury?.network === "sepolia" && (
    <div className="flex gap-2 text-[10px]">
      <a
        href="https://faucet.circle.com/"
        target="_blank"
        rel="noopener noreferrer"
        className="flex-1 text-center py-2 rounded border border-border text-muted hover:text-cyan hover:border-cyan transition-all"
      >
        USDC Faucet
      </a>
      <a
        href="https://sepoliafaucet.com/"
        target="_blank"
        rel="noopener noreferrer"
        className="flex-1 text-center py-2 rounded border border-border text-muted hover:text-cyan hover:border-cyan transition-all"
      >
        ETH Faucet (Gas)
      </a>
    </div>
  )}
</div>;
```

---

## Step 7 — New Environment Variables

Add to `.env`:

```
TREASURY_PRIVATE_KEY=0x<64-hex private key of treasury wallet>
SESSION_WALLET_ENCRYPTION_KEY=<generate: node -e "require('crypto').randomBytes(32).toString('hex')">
```

Add to `.env.example` with same keys and generation instructions.

**Treasury wallet address** = `privateKeyToAccount(TREASURY_PRIVATE_KEY).address` — this is what goes in `PAYMENT_RECEIVER_ADDRESS` too (they should match).

---

## Implementation Order

1. `server/constants/sepolia.ts` — new file, zero deps
2. `prisma/schema.prisma` + `prisma db push` — DB migration
3. `.env` — add `TREASURY_PRIVATE_KEY` + `SESSION_WALLET_ENCRYPTION_KEY`
4. `server/wallet.ts` — core signing logic
5. `server/policy.ts` — add 'sepolia' to allowedChains
6. `server/subagents/executorAgent.ts` — real Aave execution
7. `server/agent/prompts.ts` — update executor prompt
8. `client/src/app/fund/page.tsx` — Transak + faucet links

---

## Verification

### Prerequisites (testnet setup)

1. Generate or import a wallet for `TREASURY_PRIVATE_KEY`
2. Fund it with Sepolia ETH at `https://sepoliafaucet.com/` (for gas)
3. Fund it with Sepolia USDC at `https://faucet.circle.com/`
4. Set `OWS_BILLING_MODE=paid`

### Test sequence

1. `GET /api/wallet/treasury` → address should match `privateKeyToAccount(TREASURY_PRIVATE_KEY).address`
2. `POST /api/sessions` → `fundSessionWallet` fires → verify real USDC transfer on `sepolia.etherscan.io`
3. Run a full session through to executor → `execute_deposit` fires approve + supply → both txHashes visible on Etherscan → aUSDC in session wallet
4. Open `/fund` in paid mode → "Buy USDC via Transak" and faucet links visible

### Fallback behavior (free mode unchanged)

- `OWS_BILLING_MODE=free` → all mock paths untouched, no regression
- `TREASURY_PRIVATE_KEY` absent in paid mode → clear error thrown at `fundSessionWallet` call time
