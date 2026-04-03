function normalizeOrigin(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    return url.origin;
  } catch {
    return null;
  }
}

export function getSocketServerUrl(): string {
  const wsEnv = normalizeOrigin(process.env.NEXT_PUBLIC_WS_URL ?? "");
  if (wsEnv) return wsEnv;

  const apiEnv = normalizeOrigin(process.env.NEXT_PUBLIC_API_URL ?? "");
  if (apiEnv) return apiEnv;

  return "http://localhost:3001";
}
