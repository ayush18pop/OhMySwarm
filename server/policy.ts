/**
 * server/policy.ts
 *
 * Deterministic 7-check policy engine.
 * No LLM — pure data validation. Runs before every execution step.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface PolicyConfig {
  maxSingleTxUsdc: number;
  maxSessionSpendUsdc: number;
  maxSlippagePct: number;
  maxGasUsdc: number;
  allowedTokens: string[];
  allowedChains: string[];
  allowedProtocols: string[];
  requireSimulation: boolean;
}

export interface ProposedTx {
  action: "swap" | "bridge" | "lend" | "stake" | "withdraw";
  fromToken: string;
  toToken?: string;
  amountUsdc: number;
  chain: string;
  protocol: string;
  slippagePct?: number;
  estimatedGasUsdc?: number;
  sessionSpentUsdc: number;
  sessionBudgetUsdc: number;
  simulated?: boolean; // was dry-run performed?
  simDeviation?: number; // price deviation vs theoretical %
  priceImpactPct?: number;
}

export interface PolicyResult {
  approved: boolean;
  reasons: string[]; // if denied, why
  warnings: string[]; // approved but flagged
}

// ── Default Policy ───────────────────────────────────────────────────────────

export const DEFAULT_POLICY: PolicyConfig = {
  maxSingleTxUsdc: 500,
  maxSessionSpendUsdc: parseFloat(
    process.env.DEFAULT_SESSION_BUDGET_USDC ?? "2.00",
  ),
  maxSlippagePct: 2,
  maxGasUsdc: 5,
  allowedTokens: ["USDC", "WETH", "WBTC", "ETH", "DAI", "USDT"],
  allowedChains: ["base-sepolia", "base", "ethereum", "arbitrum", "sepolia"],
  allowedProtocols: ["aave-v3", "curve", "pendle", "uniswap-v3", "compound"],
  requireSimulation: true,
};

// ── Check 1–7 ────────────────────────────────────────────────────────────────

export function checkPolicy(
  tx: ProposedTx,
  policy?: PolicyConfig,
): PolicyResult {
  const p = policy ?? DEFAULT_POLICY;
  const reasons: string[] = [];
  const warnings: string[] = [];

  // 1. Single-tx spend cap
  if (tx.amountUsdc > p.maxSingleTxUsdc) {
    reasons.push(
      `Single tx $${tx.amountUsdc} exceeds limit $${p.maxSingleTxUsdc}`,
    );
  }

  // 2. Session budget remaining
  const projectedSpend = tx.sessionSpentUsdc + tx.amountUsdc;
  if (projectedSpend > tx.sessionBudgetUsdc) {
    reasons.push(
      `Would exceed session budget: $${projectedSpend.toFixed(2)} > $${tx.sessionBudgetUsdc.toFixed(2)}`,
    );
  }

  // 3. Allowed token list
  const tokensInvolved = [tx.fromToken, tx.toToken].filter(Boolean) as string[];
  for (const token of tokensInvolved) {
    if (!p.allowedTokens.includes(token.toUpperCase())) {
      reasons.push(`Token ${token} not in allowlist`);
    }
  }

  // 4. Allowed chain
  if (!p.allowedChains.includes(tx.chain)) {
    reasons.push(`Chain ${tx.chain} not in allowlist`);
  }

  // 5. Allowed protocol
  if (!p.allowedProtocols.includes(tx.protocol)) {
    reasons.push(`Protocol ${tx.protocol} not in allowlist`);
  }

  // 6. Slippage guard
  if (tx.slippagePct !== undefined && tx.slippagePct > p.maxSlippagePct) {
    reasons.push(
      `Slippage ${tx.slippagePct}% exceeds max ${p.maxSlippagePct}%`,
    );
  }

  // 7. Simulation required
  if (p.requireSimulation) {
    if (!tx.simulated) {
      reasons.push("Simulation required before execution — run dry-run first");
    } else if (tx.simDeviation !== undefined && tx.simDeviation > 5) {
      reasons.push(
        `Simulation price deviation ${tx.simDeviation.toFixed(1)}% > 5% — market moved too fast`,
      );
    } else if (tx.priceImpactPct !== undefined && tx.priceImpactPct > 3) {
      warnings.push(
        `High price impact: ${tx.priceImpactPct.toFixed(1)}% — consider splitting the order`,
      );
    }
  }

  // Gas warning (non-blocking)
  if (tx.estimatedGasUsdc !== undefined && tx.estimatedGasUsdc > p.maxGasUsdc) {
    warnings.push(
      `High gas estimate: $${tx.estimatedGasUsdc.toFixed(2)} (limit $${p.maxGasUsdc})`,
    );
  }

  return {
    approved: reasons.length === 0,
    reasons,
    warnings,
  };
}

/** Format policy result as a readable string for agent context. */
export function formatPolicyResult(result: PolicyResult): string {
  if (result.approved && result.warnings.length === 0) {
    return "POLICY: APPROVED";
  }
  const lines: string[] = [];
  if (!result.approved) {
    lines.push("POLICY: DENIED");
    result.reasons.forEach((r) => lines.push(`  ✗ ${r}`));
  } else {
    lines.push("POLICY: APPROVED WITH WARNINGS");
  }
  result.warnings.forEach((w) => lines.push(`  ⚠ ${w}`));
  return lines.join("\n");
}
