import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ObsidianClient } from "../../shared/obsidian-client.js";
import { safeTool } from "../../shared/errors.js";
import type { SimpleSearchResult } from "./search.types.js";

export function registerSearchTools(server: McpServer, client: ObsidianClient) {
  server.tool(
    "searchSimple",
    "Busca texto simples no vault do Obsidian. Retorna arquivos com trechos de contexto.",
    {
      query: z.string().describe("Texto a buscar no vault"),
      contextLength: z.number().optional().describe("Quantidade de caracteres de contexto ao redor do match (padrão: 100)"),
    },
    safeTool(async (params) => {
      const queryStr = new URLSearchParams({ query: params.query });
      if (params.contextLength) queryStr.set("contextLength", String(params.contextLength));

      const results = await client.fetchJson<SimpleSearchResult[]>(
        `/search/simple/?${queryStr.toString()}`,
        { method: "POST" }
      );

      if (!results.length) {
        return {
          content: [{ type: "text" as const, text: `Nenhum resultado para: "${params.query}"` }],
        };
      }

      const formatted = results
        .map((r) => {
          const matches = r.matches.map((m) => `  ...${m.context}...`).join("\n");
          return `### ${r.filename} (score: ${r.score})\n${matches}`;
        })
        .join("\n\n");

      return {
        content: [{ type: "text" as const, text: formatted }],
      };
    })
  );

  server.tool(
    "searchAdvanced",
    "Busca avançada no vault usando Dataview DQL ou JsonLogic.",
    {
      query: z.string().describe("Query DQL ou JsonLogic"),
      queryType: z
        .enum(["dataview", "jsonlogic"])
        .optional()
        .describe("Tipo da query: 'dataview' (padrão) ou 'jsonlogic'"),
    },
    safeTool(async (params) => {
      const isJsonLogic = params.queryType === "jsonlogic";
      const contentType = isJsonLogic
        ? "application/vnd.olrapi.jsonlogic+json"
        : "application/vnd.olrapi.dataview.dql+txt";

      const results = await client.fetchJson<unknown>("/search/", {
        method: "POST",
        headers: { "Content-Type": contentType },
        body: params.query,
      });

      return {
        content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }],
      };
    })
  );
}
