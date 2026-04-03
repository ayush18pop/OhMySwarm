import "dotenv/config";

const BASE_URL = process.env.LLM_BASE_URL ?? "https://api.openai.com/v1";
const API_KEY = process.env.LLM_API_KEY ?? "";
const MODEL = process.env.LLM_MODEL ?? "gpt-4o";

// ── Types ────────────────────────────────────────────────────────────────────

export interface LLMMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  name?: string;
  // Structured tool calls on assistant messages (avoids JSON-in-content hack)
  tool_calls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
}

export interface LLMOptions {
  system?: string;
  temperature?: number;
  max_tokens?: number;
  model?: string;
}

export interface LLMTool {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<
      string,
      { type: string; description: string; enum?: string[] }
    >;
    required: string[];
  };
}

export interface LLMToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LLMToolCallResponse {
  content: string | null;
  toolCalls: LLMToolCall[];
}

// ── Serialization ─────────────────────────────────────────────────────────────

/**
 * Convert internal LLMMessage[] to OpenAI wire format.
 * Handles the tool_calls field properly so providers get named function_responses.
 */
function toWireMessages(
  messages: LLMMessage[],
  systemPrompt?: string,
): unknown[] {
  const out: unknown[] = [];

  if (systemPrompt) {
    out.push({ role: "system", content: systemPrompt });
  }

  for (const m of messages) {
    if (m.role === "assistant" && m.tool_calls && m.tool_calls.length > 0) {
      out.push({
        role: "assistant",
        content: m.content ?? null,
        tool_calls: m.tool_calls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        })),
      });
    } else if (m.role === "tool") {
      // tool_call_id and name are required by OpenAI-compatible APIs
      out.push({
        role: "tool",
        content: m.content ?? "",
        tool_call_id: m.tool_call_id ?? "",
        name: m.name && m.name.trim() ? m.name : "tool_result",
      });
    } else {
      out.push({ role: m.role, content: m.content ?? "" });
    }
  }

  return out;
}

function headers() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${API_KEY}`,
  };
}

function parseRetryAfterMs(
  res: Response,
  errText: string,
  attempt: number,
): number {
  const header = res.headers.get("retry-after");
  if (header) {
    const seconds = Number(header);
    if (!Number.isNaN(seconds) && seconds > 0)
      return Math.ceil(seconds * 1000) + 250;
  }

  const match = errText.match(/try again in ([\d.]+)s/i);
  if (match) {
    return Math.ceil(parseFloat(match[1]) * 1000) + 500;
  }

  const backoff = Math.min(60_000, 1000 * 2 ** attempt);
  return backoff + Math.floor(Math.random() * 250);
}

async function apiPost(
  body: object,
  retries = 4,
  attempt = 0,
): Promise<Response> {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });

  if (res.status === 429 && retries > 0) {
    const errText = await res.text();
    const waitMs = parseRetryAfterMs(res, errText, attempt);
    console.warn(
      `[llm] 429 rate-limited — waiting ${waitMs}ms then retrying (${retries} left)`,
    );
    await new Promise((r) => setTimeout(r, waitMs));
    return apiPost(body, retries - 1, attempt + 1);
  }

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`LLM API error ${res.status}: ${err}`);
  }
  return res;
}

// ── Exports ──────────────────────────────────────────────────────────────────

/** Full text response — for summarizer, final answers */
export async function llmCall(
  messages: LLMMessage[],
  options?: LLMOptions,
): Promise<string> {
  const res = await apiPost({
    model: options?.model ?? MODEL,
    messages: toWireMessages(messages, options?.system),
    temperature: options?.temperature ?? 0.7,
    max_tokens: options?.max_tokens ?? 2048,
  });
  const data = (await res.json()) as {
    choices: Array<{ message: { content: string | null } }>;
  };
  return data.choices[0].message.content ?? "";
}

/** Streaming text — yields tokens for chat panel */
export async function* llmStream(
  messages: LLMMessage[],
  options?: LLMOptions,
): AsyncGenerator<string> {
  const res = await apiPost({
    model: options?.model ?? MODEL,
    messages: toWireMessages(messages, options?.system),
    temperature: options?.temperature ?? 0.7,
    max_tokens: options?.max_tokens ?? 2048,
    stream: true,
  });

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value);
    for (const line of chunk.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data: ")) continue;
      const data = trimmed.slice(6);
      if (data === "[DONE]") return;
      try {
        const parsed = JSON.parse(data) as {
          choices: Array<{ delta: { content?: string } }>;
        };
        const token = parsed.choices[0]?.delta?.content;
        if (token) yield token;
      } catch {
        /* skip malformed SSE line */
      }
    }
  }
}

/** Tool calling — for ReAct agent nodes */
export async function llmCallWithTools(
  messages: LLMMessage[],
  tools: LLMTool[],
  options?: LLMOptions,
): Promise<LLMToolCallResponse> {
  const res = await apiPost({
    model: options?.model ?? MODEL,
    messages: toWireMessages(messages, options?.system),
    temperature: options?.temperature ?? 0.2,
    max_tokens: options?.max_tokens ?? 1024,
    tools: tools.map((t) => ({ type: "function", function: t })),
    tool_choice: "auto",
  });
  const data = (await res.json()) as {
    choices: Array<{
      message: {
        content?: string | null;
        tool_calls?: Array<{
          id: string;
          function: { name: string; arguments: string };
        }>;
      };
    }>;
  };

  const msg = data.choices[0].message;
  const toolCalls: LLMToolCall[] = (msg.tool_calls ?? []).map((tc) => ({
    id: tc.id,
    name: tc.function.name,
    arguments: (() => {
      try {
        return JSON.parse(tc.function.arguments) as Record<string, unknown>;
      } catch {
        return {};
      }
    })(),
  }));

  return { content: msg.content ?? null, toolCalls };
}

/** Compress message history to a short summary for context management */
export async function summarizeMessages(
  messages: LLMMessage[],
  maxWords = 150,
): Promise<string> {
  const transcript = messages
    .map((m) => {
      const contentStr =
        typeof m.content === "string"
          ? m.content
          : JSON.stringify(m.tool_calls ?? "");
      return `[${m.role.toUpperCase()}]: ${contentStr}`;
    })
    .join("\n");

  return llmCall([{ role: "user", content: transcript }], {
    system: `Summarize the following conversation in under ${maxWords} words. Preserve every number, pool name, yield rate, and decision. Drop filler.`,
    temperature: 0,
  });
}
