import { writeFileSync, readFileSync, existsSync } from "fs";
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

function write(text: string) {
  process.stderr.write(text);
}

function createLineReader() {
  const lines: string[] = [];
  let waiting: ((line: string) => void) | null = null;
  let buffer = "";

  process.stdin.setEncoding("utf-8");
  process.stdin.on("data", (chunk: string) => {
    buffer += chunk;
    const parts = buffer.split("\n");
    buffer = parts.pop()!;
    for (const line of parts) {
      if (waiting) {
        const resolve = waiting;
        waiting = null;
        resolve(line.trim());
      } else {
        lines.push(line.trim());
      }
    }
  });

  process.stdin.on("end", () => {
    if (buffer && waiting) {
      const resolve = waiting;
      waiting = null;
      resolve(buffer.trim());
      buffer = "";
    }
  });

  return (label: string, fallback?: string): Promise<string> => {
    const suffix = fallback ? ` [${fallback}]` : "";
    write(`  ${label}${suffix}: `);

    if (lines.length > 0) {
      const value = lines.shift()!;
      write(value + "\n");
      return Promise.resolve(value || fallback || "");
    }

    return new Promise((resolve) => {
      waiting = (value) => resolve(value || fallback || "");
    });
  };
}

function mask(value: string): string {
  if (value.length <= 8) return "*".repeat(value.length);
  return value.slice(0, 4) + "*".repeat(value.length - 4);
}

export async function runSetup(): Promise<void> {
  const existing = loadSavedConfig();
  const prompt = createLineReader();

  write("\n  Obsidian MCP — Configuracao\n\n");

  const apiKey = await prompt("API Key", existing?.apiKey ? mask(existing.apiKey) : undefined);
  const host = await prompt("Host", existing?.host ?? "127.0.0.1");
  const port = await prompt("Porta", existing?.port ?? "27124");
  const protocol = await prompt("Protocolo", existing?.protocol ?? "https");

  process.stdin.destroy();

  if (!apiKey || apiKey.includes("*")) {
    if (existing?.apiKey && apiKey.includes("*")) {
      saveConfig({ apiKey: existing.apiKey, host, port, protocol });
      return;
    }
    write("\n  API Key e obrigatoria.\n\n");
    process.exit(1);
  }

  saveConfig({ apiKey, host, port, protocol });
}

function saveConfig(config: SavedConfig) {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  write(`\n  Configuracao salva em ${CONFIG_PATH}\n`);
  write("\n  Adicione ao Claude Code:\n");
  write("    claude mcp add obsidian -- npx @leonardocrdso/obsidian-mcp\n\n");
}
