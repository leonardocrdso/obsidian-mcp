import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ObsidianClient } from "../../shared/obsidian-client.js";
import { safeTool } from "../../shared/errors.js";
import type { SimpleSearchResult } from "./search.types.js";

const searchSimpleSchema = {
  query: z.string().describe("Texto a buscar no vault"),
  contextLength: z.number().optional().describe("Quantidade de caracteres de contexto ao redor do match (padrão: 100)"),
};

const searchAdvancedSchema = {
  query: z.string().describe("Query DQL ou JsonLogic"),
  queryType: z
    .enum(["dataview", "jsonlogic"])
    .optional()
    .describe("Tipo da query: 'dataview' (padrão) ou 'jsonlogic'"),
};

type SearchSimpleParams = { query: string; contextLength?: number };
type SearchAdvancedParams = { query: string; queryType?: "dataview" | "jsonlogic" };

function formatSearchResults(results: SimpleSearchResult[], query: string): string {
  if (!results.length) return `Nenhum resultado para: "${query}"`;
  return results
    .map((r) => {
      const matches = r.matches.map((m) => `  ...${m.context}...`).join("\n");
      return `### ${r.filename} (score: ${r.score})\n${matches}`;
    })
    .join("\n\n");
}

async function handleSearchSimple(client: ObsidianClient, params: SearchSimpleParams) {
  const queryStr = new URLSearchParams({ query: params.query });
  if (params.contextLength) queryStr.set("contextLength", String(params.contextLength));

  const results = await client.fetchJson<SimpleSearchResult[]>(
    `/search/simple/?${queryStr.toString()}`,
    { method: "POST" }
  );

  return {
    content: [{ type: "text" as const, text: formatSearchResults(results, params.query) }],
  };
}

async function handleSearchAdvanced(client: ObsidianClient, params: SearchAdvancedParams) {
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
}

export function registerSearchTools(server: McpServer, client: ObsidianClient) {
  server.tool(
    "searchSimple",
    "Busca texto simples no vault do Obsidian. Retorna arquivos com trechos de contexto.",
    searchSimpleSchema,
    safeTool((params: SearchSimpleParams) => handleSearchSimple(client, params))
  );

  server.tool(
    "searchAdvanced",
    "Busca avançada no vault usando Dataview DQL ou JsonLogic.",
    searchAdvancedSchema,
    safeTool((params: SearchAdvancedParams) => handleSearchAdvanced(client, params))
  );
}
