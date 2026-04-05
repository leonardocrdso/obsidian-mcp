import { writeFileSync, readFileSync, existsSync } from "fs";
import { createInterface } from "readline";
import { homedir } from "os";
import { join } from "path";

const CONFIG_PATH = join(homedir(), ".obsidian-mcp.json");

export interface SavedConfig {
  apiKey: string;
  host: string;
  port: string;
  protocol: string;
}

export function loadSavedConfig(): SavedConfig | null {
  if (!existsSync(CONFIG_PATH)) return null;
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
  } catch {
    return null;
  }
}

function mask(value: string): string {
  if (value.length <= 8) return "*".repeat(value.length);
  return value.slice(0, 4) + "*".repeat(value.length - 4);
}

function createPrompt() {
  const lines: string[] = [];
  let waiting: ((line: string) => void) | null = null;

  const rl = createInterface({ input: process.stdin, output: process.stderr });

  rl.on("line", (line) => {
    if (waiting) {
      const resolve = waiting;
      waiting = null;
      resolve(line);
    } else {
      lines.push(line);
    }
  });

  rl.on("close", () => {
    if (waiting) {
      const resolve = waiting;
      waiting = null;
      resolve("");
    }
  });

  const ask = (label: string, fallback?: string): Promise<string> => {
    const suffix = fallback ? ` [${fallback}]` : "";
    process.stderr.write(`  ${label}${suffix}: `);

    if (lines.length > 0) {
      const value = lines.shift()!;
      process.stderr.write(value + "\n");
      return Promise.resolve(value.trim() || fallback || "");
    }

    return new Promise((resolve) => {
      waiting = (value) => resolve(value.trim() || fallback || "");
    });
  };

  return { ask, close: () => rl.close() };
}

export async function runSetup(): Promise<void> {
  const existing = loadSavedConfig();
  const { ask, close } = createPrompt();

  process.stderr.write("\n  Obsidian MCP — Configuracao\n\n");

  const apiKey = await ask("API Key", existing?.apiKey ? mask(existing.apiKey) : undefined);
  const host = await ask("Host", existing?.host ?? "127.0.0.1");
  const port = await ask("Porta", existing?.port ?? "27124");
  const protocol = await ask("Protocolo", existing?.protocol ?? "https");

  close();

  if (!apiKey || apiKey.includes("*")) {
    if (existing?.apiKey && apiKey.includes("*")) {
      saveConfig({ apiKey: existing.apiKey, host, port, protocol });
      return;
    }
    process.stderr.write("\n  API Key e obrigatoria.\n\n");
    process.exit(1);
  }

  saveConfig({ apiKey, host, port, protocol });
}

function saveConfig(config: SavedConfig) {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  process.stderr.write(`\n  Configuracao salva em ${CONFIG_PATH}\n`);
  process.stderr.write("\n  Adicione ao Claude Code:\n");
  process.stderr.write("    claude mcp add obsidian -- npx @leonardocrdso/obsidian-mcp\n\n");
}
