/**
 * server/wallet.ts
 *
 * Treasury wallet signs real Sepolia USDC transfers in paid mode.
 * Session wallets are ephemeral keypairs encrypted in DB.
 * Free mode remains mock and deterministic for local development.
 */

import "dotenv/config";
import crypto from "crypto";
import { createPublicClient, createWalletClient, http, parseEther } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { prisma } from "./db";
import {
  ERC20_ABI,
  USDC_ADDRESS,
  USDC_DECIMALS,
  toUsdcUnits,
} from "./constants/sepolia";

const PAYMENT_NETWORK = process.env.PAYMENT_NETWORK ?? "sepolia";
const TREASURY_WALLET_NAME =
  process.env.OWS_TREASURY_WALLET_NAME ?? "ohmyswarm-treasury";
const DEFAULT_MOCK_TREASURY_BALANCE = parseFloat(
  process.env.OWS_MOCK_TREASURY_BALANCE_USDC ?? "10",
);
const BILLING_MODE = (process.env.OWS_BILLING_MODE ?? "free").toLowerCase();
const SESSION_WALLET_GAS_TOPUP_ETH =
  process.env.SESSION_WALLET_GAS_TOPUP_ETH ?? "0.0015";

let warnedMissingEncryptionKey = false;

// ── Types ────────────────────────────────────────────────────────────────────

export interface WalletInfo {
  name: string;
  address: string;
  balance?: number;
}

export interface X402PaymentInfo {
  amount: string; // USDC as decimal string e.g. "0.05"
  token: "USDC";
  network: string;
  address: string; // recipient
  chainId: number;
}

// ── Mode / env helpers ───────────────────────────────────────────────────────

export function isPaidModeEnabled(): boolean {
  return BILLING_MODE === "paid";
}

function getRpcUrl(): string {
  const rpc = process.env.FUNDING_RPC_URL ?? process.env.PAYMENT_RPC_URL;
  if (!rpc) {
    throw new Error(
      "FUNDING_RPC_URL (or PAYMENT_RPC_URL) is required in paid mode",
    );
  }
  return rpc;
}

function normalizePrivateKey(raw: string): `0x${string}` {
  const key = raw.startsWith("0x") ? raw : `0x${raw}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error("Invalid private key format");
  }
  return key as `0x${string}`;
}

function normalizeAddress(raw: string): `0x${string}` {
  if (!/^0x[0-9a-fA-F]{40}$/.test(raw)) {
    throw new Error(`Invalid EVM address: ${raw}`);
  }
  return raw as `0x${string}`;
}

function getEncryptionKeyBuffer(): Buffer | null {
  const raw = process.env.SESSION_WALLET_ENCRYPTION_KEY;
  if (!raw) return null;
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error(
      "SESSION_WALLET_ENCRYPTION_KEY must be 64 hex chars (32 bytes)",
    );
  }
  return Buffer.from(raw, "hex");
}

function warnMissingEncryptionKey() {
  if (warnedMissingEncryptionKey) return;
  warnedMissingEncryptionKey = true;
  console.warn(
    "[wallet] SESSION_WALLET_ENCRYPTION_KEY is missing; storing session keys as raw private keys (testnet-only fallback)",
  );
}

function getTreasuryAddressFallback(): `0x${string}` {
  const envAddr = process.env.PAYMENT_RECEIVER_ADDRESS;
  if (envAddr && /^0x[0-9a-fA-F]{40}$/.test(envAddr)) {
    return envAddr as `0x${string}`;
  }
  return ensureMockWallet(TREASURY_WALLET_NAME).address as `0x${string}`;
}

function getTreasuryAccountOrNull() {
  const raw = process.env.TREASURY_PRIVATE_KEY;
  if (!raw) return null;
  return privateKeyToAccount(normalizePrivateKey(raw));
}

function getRequiredTreasuryAccount() {
  const account = getTreasuryAccountOrNull();
  if (!account) {
    throw new Error(
      "TREASURY_PRIVATE_KEY is required in paid mode to sign real USDC transfers",
    );
  }
  return account;
}

function getPublicClient() {
  return createPublicClient({ chain: sepolia, transport: http(getRpcUrl()) });
}

function normalizePaymentError(err: unknown, context: string): Error {
  const message = err instanceof Error ? err.message : String(err);
  const lowered = message.toLowerCase();

  if (lowered.includes("insufficient funds") && lowered.includes("gas")) {
    return new Error(
      `${context} failed: insufficient ETH for gas in the signing wallet. Increase SESSION_WALLET_GAS_TOPUP_ETH or fund treasury/session wallet with Sepolia ETH.`,
    );
  }

  return new Error(`${context} failed: ${message}`);
}

// ── Key encryption helpers ───────────────────────────────────────────────────

export function encryptKey(rawHex: string): string {
  const normalized = normalizePrivateKey(rawHex);
  const key = getEncryptionKeyBuffer();

  if (!key) {
    warnMissingEncryptionKey();
    return normalized;
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(normalized, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptKey(cipherText: string): string {
  // Raw fallback format.
  if (!cipherText.includes(":")) {
    return normalizePrivateKey(cipherText);
  }

  const key = getEncryptionKeyBuffer();
  if (!key) {
    throw new Error(
      "SESSION_WALLET_ENCRYPTION_KEY is required to decrypt session wallet keys",
    );
  }

  const parts = cipherText.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted key format");
  }

  const [ivHex, authTagHex, encryptedHex] = parts;
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivHex, "hex"),
  );
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedHex, "hex")),
    decipher.final(),
  ]).toString("utf8");

  return normalizePrivateKey(decrypted);
}

// ── In-memory wallets for free mode ──────────────────────────────────────────

const mockWalletStore = new Map<
  string,
  { address: string; balanceUsdc: number }
>();

function mockAddress(name: string): string {
  const hash = crypto.createHash("sha256").update(name).digest("hex");
  return `0x${hash.slice(0, 40)}`;
}

function ensureMockWallet(name: string): {
  address: string;
  balanceUsdc: number;
} {
  const existing = mockWalletStore.get(name);
  if (existing) return existing;

  const wallet = {
    address: mockAddress(name),
    balanceUsdc:
      name === TREASURY_WALLET_NAME ? DEFAULT_MOCK_TREASURY_BALANCE : 0,
  };
  mockWalletStore.set(name, wallet);
  return wallet;
}

// ── Wallet lifecycle ─────────────────────────────────────────────────────────

export async function createAgentWallet(name: string): Promise<WalletInfo> {
  const wallet = ensureMockWallet(name);
  return { name, address: wallet.address, balance: wallet.balanceUsdc };
}

async function readUsdcBalance(address: `0x${string}`): Promise<number> {
  const raw = (await getPublicClient().readContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [address],
  })) as bigint;

  return Number(raw) / 10 ** USDC_DECIMALS;
}

/** Get USDC balance for a given wallet name. */
export async function getWalletBalance(name: string): Promise<number> {
  if (!isPaidModeEnabled()) {
    return ensureMockWallet(name).balanceUsdc;
  }

  try {
    const address = await getWalletAddress(name);
    return await readUsdcBalance(normalizeAddress(address));
  } catch {
    if (name === TREASURY_WALLET_NAME) {
      const envBalance = process.env.OWS_TREASURY_BALANCE_USDC;
      if (envBalance !== undefined) {
        const parsed = Number(envBalance);
        if (!Number.isNaN(parsed)) return parsed;
      }
    }
    return ensureMockWallet(name).balanceUsdc;
  }
}

/**
 * Record a treasury top-up in free mode.
 * In paid mode, funding is on-chain so we return the live balance.
 */
export async function recordTreasuryTopUp(amountUsdc: number): Promise<number> {
  if (isPaidModeEnabled()) {
    return getWalletBalance(TREASURY_WALLET_NAME);
  }

  const wallet = ensureMockWallet(TREASURY_WALLET_NAME);
  wallet.balanceUsdc += amountUsdc;
  mockWalletStore.set(TREASURY_WALLET_NAME, wallet);
  return wallet.balanceUsdc;
}

/**
 * Fund a new session wallet with USDC from the treasury.
 * Returns wallet info. In free mode, simulates funding.
 */
export async function fundSessionWallet(
  sessionId: string,
  budgetUsdc: number,
): Promise<{ walletName: string; walletAddress: string; txHash: string }> {
  const walletName = `session-${sessionId}`;

  if (!isPaidModeEnabled()) {
    const wallet = await createAgentWallet(walletName);
    const sessionWallet = ensureMockWallet(walletName);
    sessionWallet.balanceUsdc = Math.max(
      sessionWallet.balanceUsdc,
      budgetUsdc * 10,
    );
    mockWalletStore.set(walletName, sessionWallet);

    const txHash = `0x${crypto.randomBytes(32).toString("hex")}`;
    console.log(
      `[wallet:free] Mock funded session wallet ${walletName} with virtual budget $${budgetUsdc} USDC`,
    );
    return { walletName, walletAddress: wallet.address, txHash };
  }

  const treasuryBalance = await getWalletBalance(TREASURY_WALLET_NAME);
  if (treasuryBalance < budgetUsdc) {
    throw new Error(
      `Insufficient master wallet balance. Have $${treasuryBalance.toFixed(4)}, need $${budgetUsdc.toFixed(4)}`,
    );
  }

  const sessionPrivateKey = generatePrivateKey();
  const sessionAccount = privateKeyToAccount(sessionPrivateKey);

  await prisma.session.update({
    where: { id: sessionId },
    data: {
      sessionWalletName: walletName,
      sessionWalletAddress: sessionAccount.address,
      sessionWalletKey: encryptKey(sessionPrivateKey),
    },
  });

  const treasuryAccount = getRequiredTreasuryAccount();
  const walletClient = createWalletClient({
    account: treasuryAccount,
    chain: sepolia,
    transport: http(getRpcUrl()),
  });

  const hash = await walletClient.writeContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "transfer",
    args: [sessionAccount.address, toUsdcUnits(budgetUsdc)],
  });

  const receipt = await getPublicClient().waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error("Treasury to session wallet USDC transfer failed");
  }

  let gasTopUpHash: `0x${string}` | null = null;
  const gasEth = Number(SESSION_WALLET_GAS_TOPUP_ETH);
  if (!Number.isNaN(gasEth) && gasEth > 0) {
    try {
      gasTopUpHash = await walletClient.sendTransaction({
        to: sessionAccount.address,
        value: parseEther(String(gasEth)),
      });

      const gasReceipt = await getPublicClient().waitForTransactionReceipt({
        hash: gasTopUpHash,
      });
      if (gasReceipt.status !== "success") {
        throw new Error("Session wallet ETH top-up transaction failed");
      }
    } catch (err) {
      throw normalizePaymentError(err, "Session wallet ETH top-up");
    }
  }

  console.log(
    `[wallet] Funded session wallet ${walletName} with $${budgetUsdc} USDC on ${PAYMENT_NETWORK}${gasTopUpHash ? ` + ${SESSION_WALLET_GAS_TOPUP_ETH} ETH gas top-up` : ""} (usdcTx=${hash}${gasTopUpHash ? `, gasTx=${gasTopUpHash}` : ""})`,
  );

  return { walletName, walletAddress: sessionAccount.address, txHash: hash };
}

/**
 * Sign an x402 payment from a session wallet.
 * In paid mode this performs a real USDC transfer from session wallet.
 */
export async function payX402(
  walletName: string,
  paymentInfo: X402PaymentInfo,
): Promise<{ txHash: string; amountPaid: number }> {
  const amount = parseFloat(paymentInfo.amount);

  if (!isPaidModeEnabled()) {
    const txHash = `0x${crypto.randomBytes(32).toString("hex")}`;
    console.log(
      `[wallet:free] Mock x402 pay ${paymentInfo.amount} USDC → ${paymentInfo.address}`,
    );
    return { txHash, amountPaid: amount };
  }

  const session = await prisma.session.findFirst({
    where: { sessionWalletName: walletName },
    select: {
      id: true,
      sessionWalletAddress: true,
      sessionWalletKey: true,
    },
  });

  if (!session) {
    throw new Error(`No session found for wallet ${walletName}`);
  }
  if (!session.sessionWalletKey) {
    throw new Error(`Session wallet key missing for ${walletName}`);
  }

  const sessionKey = decryptKey(session.sessionWalletKey);
  const sessionAccount = privateKeyToAccount(normalizePrivateKey(sessionKey));

  const walletClient = createWalletClient({
    account: sessionAccount,
    chain: sepolia,
    transport: http(getRpcUrl()),
  });

  const recipient = normalizeAddress(paymentInfo.address);
  let hash: `0x${string}`;
  try {
    hash = await walletClient.writeContract({
      address: USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: "transfer",
      args: [recipient, toUsdcUnits(paymentInfo.amount)],
    });
  } catch (err) {
    throw normalizePaymentError(err, "x402 USDC transfer");
  }

  const receipt = await getPublicClient().waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error("x402 USDC transfer failed");
  }

  console.log(
    `[wallet] x402 payment sent from ${walletName} -> ${recipient} amount=${paymentInfo.amount} USDC tx=${hash}`,
  );

  return { txHash: hash, amountPaid: amount };
}

export async function verifyFundingTransaction(
  txHash: string,
): Promise<{ verified: boolean; reason?: string }> {
  if (!isPaidModeEnabled()) {
    return { verified: true };
  }

  if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
    return { verified: false, reason: "Invalid txHash format" };
  }

  try {
    const receipt = await getPublicClient().getTransactionReceipt({
      hash: txHash as `0x${string}`,
    });

    if (receipt.status !== "success") {
      return { verified: false, reason: "Transaction did not succeed" };
    }
    return { verified: true };
  } catch (err) {
    return {
      verified: false,
      reason: `Unable to verify funding tx: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Sweep remaining USDC from session wallet back to treasury.
 * Left as non-blocking best effort for now.
 */
export async function sweepSessionWallet(sessionId: string): Promise<void> {
  const walletName = `session-${sessionId}`;
  console.log(
    `[wallet] Sweeping session wallet ${walletName} back to treasury`,
  );
}

/** Get wallet address for a given name. */
export async function getWalletAddress(name: string): Promise<string> {
  if (isPaidModeEnabled() && name === TREASURY_WALLET_NAME) {
    const treasury = getTreasuryAccountOrNull();
    return treasury?.address ?? getTreasuryAddressFallback();
  }

  if (name.startsWith("session-")) {
    const session = await prisma.session.findFirst({
      where: { sessionWalletName: name },
      select: { sessionWalletAddress: true },
    });
    if (session?.sessionWalletAddress) {
      return session.sessionWalletAddress;
    }
  }

  return ensureMockWallet(name).address;
}
