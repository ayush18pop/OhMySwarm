/**
 * server/routes/subagents.ts
 *
 * x402-gated sub-agent endpoints. Each endpoint:
 *   1. x402 middleware checks the payment header
 *   2. Runs the appropriate sub-agent
 *   3. Returns the result
 *
 * POST /agents/portfolio-scout
 * POST /agents/yield-scanner
 * POST /agents/risk-analyst
 * POST /agents/route-planner
 * POST /agents/executor
 */

import { Router, Request, Response } from "express";
import { runPortfolioScout } from "../subagents/portfolioScout";
import { runYieldScanner } from "../subagents/yieldScanner";
import { runRiskAnalyst } from "../subagents/riskAnalyst";
import { runRoutePlanner } from "../subagents/routePlanner";
import { runExecutor } from "../subagents/executorAgent";
import { runChainAnalyst } from "../subagents/chainAnalyst";
import { runTokenAnalyst } from "../subagents/tokenAnalyst";
import { runProtocolResearcher } from "../subagents/protocolResearcher";
import { runLiquidityScout } from "../subagents/liquidityScout";

const router = Router();

interface SubAgentBody {
  agentId: string;
  sessionId: string;
  task: string;
  budgetUsdc: number;
  context?: string;
}

function validateBody(body: Partial<SubAgentBody>): body is SubAgentBody {
  return (
    typeof body.agentId === "string" &&
    typeof body.sessionId === "string" &&
    typeof body.task === "string" &&
    typeof body.budgetUsdc === "number"
  );
}

async function handleSubAgent(
  req: Request,
  res: Response,
  role: string,
  runner: (
    input: SubAgentBody & { role: string },
  ) => Promise<{ output: string; spentUsdc: number }>,
) {
  const body = req.body as Partial<SubAgentBody>;
  if (!validateBody(body)) {
    return res
      .status(400)
      .json({
        error: "Missing required fields: agentId, sessionId, task, budgetUsdc",
      });
  }

  try {
    const result = await runner({ ...body, role });
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
}

router.post("/portfolio-scout", (req, res) =>
  handleSubAgent(req, res, "portfolio-scout", runPortfolioScout),
);
router.post("/yield-scanner", (req, res) =>
  handleSubAgent(req, res, "yield-scanner", runYieldScanner),
);
router.post("/risk-analyst", (req, res) =>
  handleSubAgent(req, res, "risk-analyst", runRiskAnalyst),
);
router.post("/route-planner", (req, res) =>
  handleSubAgent(req, res, "route-planner", runRoutePlanner),
);
router.post("/executor", (req, res) =>
  handleSubAgent(req, res, "executor", runExecutor),
);
router.post("/chain-analyst", (req, res) =>
  handleSubAgent(req, res, "chain-analyst", runChainAnalyst),
);
router.post("/token-analyst", (req, res) =>
  handleSubAgent(req, res, "token-analyst", runTokenAnalyst),
);
router.post("/protocol-researcher", (req, res) =>
  handleSubAgent(req, res, "protocol-researcher", runProtocolResearcher),
);
router.post("/liquidity-scout", (req, res) =>
  handleSubAgent(req, res, "liquidity-scout", runLiquidityScout),
);

export default router;
