/**
 * server/routes/wallet.ts
 *
 * GET  /api/wallet/treasury   — treasury wallet address
 * GET  /api/wallet/:sessionId — session wallet state
 */

import { Router, Request, Response } from "express";
import { prisma } from "../db";
import {
  getWalletAddress,
  getWalletBalance,
  isPaidModeEnabled,
  recordTreasuryTopUp,
  verifyFundingTransaction,
} from "../wallet";
const router = Router();

async function getTreasurySnapshot() {
  const name = process.env.OWS_TREASURY_WALLET_NAME ?? "ohmyswarm-treasury";
  const [address, balance] = await Promise.all([
    getWalletAddress(name).catch(
      () => "0x0000000000000000000000000000000000000000",
    ),
    getWalletBalance(name).catch(() => 0),
  ]);
  return {
    name,
    address,
    balance,
    network: process.env.PAYMENT_NETWORK ?? "base-sepolia",
    token: "USDC",
    billingMode: isPaidModeEnabled() ? "paid" : "free",
  };
}

router.get("/", async (_req: Request, res: Response) => {
  res.json(await getTreasurySnapshot());
});

router.get("/treasury", async (_req: Request, res: Response) => {
  res.json(await getTreasurySnapshot());
});

router.post("/fund", async (req: Request, res: Response) => {
  const { amountUsdc, userWalletAddress, txHash } = req.body as {
    amountUsdc?: number;
    userWalletAddress?: string;
    txHash?: string;
  };

  if (
    typeof amountUsdc !== "number" ||
    Number.isNaN(amountUsdc) ||
    amountUsdc <= 0
  ) {
    return res
      .status(400)
      .json({ error: "amountUsdc must be a positive number" });
  }

  if (isPaidModeEnabled()) {
    if (!txHash || typeof txHash !== "string") {
      return res.status(400).json({
        error: "txHash is required in paid mode",
      });
    }

    const verification = await verifyFundingTransaction(txHash);
    if (!verification.verified) {
      return res.status(400).json({
        error: verification.reason ?? "Funding transaction verification failed",
      });
    }
  }

  const newBalance = await recordTreasuryTopUp(amountUsdc);
  const snapshot = await getTreasurySnapshot();

  res.json({
    confirmed: true,
    txHash: txHash ?? "free-mode-no-tx",
    amountUsdc,
    userWalletAddress: userWalletAddress ?? null,
    newBalance,
    treasuryAddress: snapshot.address,
    network: snapshot.network,
    token: snapshot.token,
  });
});

router.get("/:sessionId", async (req: Request, res: Response) => {
  const sessionId = String(req.params.sessionId);
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      sessionWalletName: true,
      sessionWalletAddress: true,
      budgetUsdc: true,
      spentUsdc: true,
    },
  });
  if (!session) return res.status(404).json({ error: "Session not found" });
  res.json(session);
});

export default router;
