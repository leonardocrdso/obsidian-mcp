import { loadSavedConfig } from "./setup.js";

function loadConfig() {
  const saved = loadSavedConfig();
  if (saved) {
    const baseUrl = `${saved.protocol}://${saved.host}:${saved.port}`;
    return { ...saved, baseUrl } as const;
  }

  const apiKey = process.env.OBSIDIAN_API_KEY;
  if (apiKey) {
    const host = process.env.OBSIDIAN_HOST ?? "127.0.0.1";
    const port = process.env.OBSIDIAN_PORT ?? "27124";
    const protocol = process.env.OBSIDIAN_PROTOCOL ?? "https";
    const baseUrl = `${protocol}://${host}:${port}`;
    return { apiKey, host, port, protocol, baseUrl } as const;
  }

  throw new Error(
    "Obsidian MCP nao configurado. Execute: npx @leonardocrdso/obsidian-mcp --setup"
  );
}

let cached: ReturnType<typeof loadConfig> | null = null;

export function getConfig() {
  if (!cached) cached = loadConfig();
  return cached;
}
