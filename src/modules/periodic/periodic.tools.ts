import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ObsidianClient } from "../../shared/obsidian-client.js";
import { safeTool } from "../../shared/errors.js";
import { PERIODS } from "./periodic.types.js";

const periodSchema = z.enum(PERIODS).describe("Período: daily, weekly, monthly, quarterly ou yearly");

export function registerPeriodicTools(server: McpServer, client: ObsidianClient) {
  server.tool(
    "periodicGetNote",
    "Retorna o conteúdo da nota periódica atual (daily, weekly, etc).",
    {
      period: periodSchema,
    },
    safeTool(async (params) => {
      const text = await client.fetchText(`/periodic/${params.period}/`);
      return {
        content: [{ type: "text" as const, text }],
      };
    })
  );

  server.tool(
    "periodicCreateNote",
    "Cria ou substitui a nota periódica atual.",
    {
      period: periodSchema,
      content: z.string().describe("Conteúdo da nota periódica"),
    },
    safeTool(async (params) => {
      await client.fetchVoid(`/periodic/${params.period}/`, {
        method: "PUT",
        headers: { "Content-Type": "text/markdown" },
        body: params.content,
      });
      return {
        content: [{ type: "text" as const, text: `Nota ${params.period} criada/atualizada.` }],
      };
    })
  );

  server.tool(
    "periodicAppendContent",
    "Adiciona conteúdo ao final da nota periódica atual.",
    {
      period: periodSchema,
      content: z.string().describe("Conteúdo a adicionar ao final"),
    },
    safeTool(async (params) => {
      await client.fetchVoid(`/periodic/${params.period}/`, {
        method: "POST",
        headers: { "Content-Type": "text/markdown" },
        body: params.content,
      });
      return {
        content: [{ type: "text" as const, text: `Conteúdo adicionado à nota ${params.period}.` }],
      };
    })
  );

  server.tool(
    "periodicPatchContent",
    "Insere conteúdo em um local específico da nota periódica (heading, block ou frontmatter).",
    {
      period: periodSchema,
      content: z.string().describe("Conteúdo a inserir"),
      operation: z.enum(["append", "prepend", "replace"]).describe("Operação: append, prepend ou replace"),
      targetType: z.enum(["heading", "block", "frontmatter"]).describe("Tipo do alvo: heading, block ou frontmatter"),
      target: z.string().describe("Identificador do alvo"),
      targetDelimiter: z.string().optional().describe("Delimitador para separar conteúdo inserido"),
      trimTargetWhitespace: z.boolean().optional().describe("Remover espaços do target antes de comparar"),
    },
    safeTool(async (params) => {
      const headers: Record<string, string> = {
        "Content-Type": "text/markdown",
        Operation: params.operation,
        "Target-Type": params.targetType,
        Target: params.target,
      };
      if (params.targetDelimiter) headers["Target-Delimiter"] = params.targetDelimiter;
      if (params.trimTargetWhitespace !== undefined) {
        headers["Trim-Target-Whitespace"] = String(params.trimTargetWhitespace);
      }

      await client.fetchVoid(`/periodic/${params.period}/`, {
        method: "PATCH",
        headers,
        body: params.content,
      });
      return {
        content: [{ type: "text" as const, text: `Nota ${params.period} atualizada no local especificado.` }],
      };
    })
  );

  server.tool(
    "periodicDeleteNote",
    "Remove a nota periódica atual.",
    {
      period: periodSchema,
    },
    safeTool(async (params) => {
      await client.fetchVoid(`/periodic/${params.period}/`, { method: "DELETE" });
      return {
        content: [{ type: "text" as const, text: `Nota ${params.period} removida.` }],
      };
    })
  );
}
