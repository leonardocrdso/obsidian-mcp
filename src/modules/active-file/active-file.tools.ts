import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ObsidianClient } from "../../shared/obsidian-client.js";
import { safeTool } from "../../shared/errors.js";

export function registerActiveFileTools(server: McpServer, client: ObsidianClient) {
  server.tool(
    "activeFileGet",
    "Retorna o conteúdo do arquivo atualmente aberto no Obsidian.",
    {},
    safeTool(async () => {
      const text = await client.fetchText("/active/");
      return {
        content: [{ type: "text" as const, text }],
      };
    })
  );

  server.tool(
    "activeFileUpdate",
    "Substitui o conteúdo inteiro do arquivo ativo no Obsidian.",
    {
      content: z.string().describe("Novo conteúdo para substituir o arquivo ativo"),
    },
    safeTool(async (params) => {
      await client.fetchVoid("/active/", {
        method: "PUT",
        headers: { "Content-Type": "text/markdown" },
        body: params.content,
      });
      return {
        content: [{ type: "text" as const, text: "Arquivo ativo atualizado." }],
      };
    })
  );

  server.tool(
    "activeFileAppend",
    "Adiciona conteúdo ao final do arquivo ativo no Obsidian.",
    {
      content: z.string().describe("Conteúdo a adicionar ao final"),
    },
    safeTool(async (params) => {
      await client.fetchVoid("/active/", {
        method: "POST",
        headers: { "Content-Type": "text/markdown" },
        body: params.content,
      });
      return {
        content: [{ type: "text" as const, text: "Conteúdo adicionado ao arquivo ativo." }],
      };
    })
  );

  server.tool(
    "activeFilePatch",
    "Insere conteúdo em um local específico do arquivo ativo (heading, block ou frontmatter).",
    {
      content: z.string().describe("Conteúdo a inserir"),
      operation: z.enum(["append", "prepend", "replace"]).describe("Operação: append, prepend ou replace"),
      targetType: z.enum(["heading", "block", "frontmatter"]).describe("Tipo do alvo: heading, block ou frontmatter"),
      target: z.string().describe("Identificador do alvo"),
      targetDelimiter: z.string().optional().describe("Delimitador para separar conteúdo inserido"),
      trimTargetWhitespace: z.boolean().optional().describe("Remover espaços do target antes de comparar"),
      createTargetIfMissing: z.boolean().optional().describe("Criar o alvo se não existir no arquivo"),
    },
    safeTool(async (params) => {
      const headers: Record<string, string> = {
        "Content-Type": "text/markdown",
        Operation: params.operation,
        "Target-Type": params.targetType,
        Target: encodeURIComponent(params.target),
      };
      if (params.targetDelimiter) headers["Target-Delimiter"] = params.targetDelimiter;
      if (params.trimTargetWhitespace !== undefined) {
        headers["Trim-Target-Whitespace"] = String(params.trimTargetWhitespace);
      }
      if (params.createTargetIfMissing !== undefined) {
        headers["Create-Target-If-Missing"] = String(params.createTargetIfMissing);
      }

      await client.fetchVoid("/active/", {
        method: "PATCH",
        headers,
        body: params.content,
      });
      return {
        content: [{ type: "text" as const, text: "Arquivo ativo atualizado no local especificado." }],
      };
    })
  );

  server.tool(
    "activeFileDelete",
    "Remove o arquivo atualmente aberto no Obsidian.",
    {},
    safeTool(async () => {
      await client.fetchVoid("/active/", { method: "DELETE" });
      return {
        content: [{ type: "text" as const, text: "Arquivo ativo removido." }],
      };
    })
  );
}
