import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ObsidianClient } from "../../shared/obsidian-client.js";
import { safeTool } from "../../shared/errors.js";

interface ObsidianCommand {
  id: string;
  name: string;
}

export function registerCommandsTools(server: McpServer, client: ObsidianClient) {
  server.tool(
    "commandsList",
    "Lista todos os comandos disponíveis no Obsidian.",
    {},
    safeTool(async () => {
      const response = await client.fetchJson<{ commands: ObsidianCommand[] }>("/commands/");
      const formatted = response.commands.map((cmd) => `${cmd.id} — ${cmd.name}`).join("\n");
      return {
        content: [{ type: "text" as const, text: formatted || "Nenhum comando encontrado." }],
      };
    })
  );

  server.tool(
    "commandsExecute",
    "Executa um comando do Obsidian pelo ID.",
    {
      commandId: z.string().describe("ID do comando a executar (ex: 'app:toggle-left-sidebar')"),
    },
    safeTool(async (params) => {
      await client.fetchVoid(`/commands/${encodeURIComponent(params.commandId)}/`, {
        method: "POST",
      });
      return {
        content: [{ type: "text" as const, text: `Comando executado: ${params.commandId}` }],
      };
    })
  );
}
