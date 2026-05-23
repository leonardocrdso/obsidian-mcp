import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ObsidianClient } from "../../shared/obsidian-client.js";
import { safeTool } from "../../shared/errors.js";

const patchFields = {
  operation: z.enum(["append", "prepend", "replace"]).describe("Operação: append, prepend ou replace"),
  targetType: z.enum(["heading", "block", "frontmatter"]).describe("Tipo do alvo: heading, block ou frontmatter"),
  target: z.string().describe("Identificador do alvo"),
  targetDelimiter: z.string().optional().describe("Delimitador para separar conteúdo inserido"),
  trimTargetWhitespace: z.boolean().optional().describe("Remover espaços do target antes de comparar"),
  createTargetIfMissing: z.boolean().optional().describe("Criar o alvo se não existir no arquivo"),
};

const activeFileUpdateSchema = {
  content: z.string().describe("Novo conteúdo para substituir o arquivo ativo"),
};

const activeFileAppendSchema = {
  content: z.string().describe("Conteúdo a adicionar ao final"),
};

const activeFilePatchSchema = {
  content: z.string().describe("Conteúdo a inserir"),
  ...patchFields,
};

type ActiveFileUpdateParams = { content: string };
type ActiveFileAppendParams = { content: string };
type ActiveFilePatchParams = {
  content: string;
  operation: "append" | "prepend" | "replace";
  targetType: "heading" | "block" | "frontmatter";
  target: string;
  targetDelimiter?: string;
  trimTargetWhitespace?: boolean;
  createTargetIfMissing?: boolean;
};

type PatchHeaderParams = {
  operation: string;
  targetType: string;
  target: string;
  targetDelimiter?: string;
  trimTargetWhitespace?: boolean;
  createTargetIfMissing?: boolean;
};

function buildPatchHeaders(params: PatchHeaderParams): Record<string, string> {
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
  return headers;
}

async function handleActiveFileGet(client: ObsidianClient) {
  const text = await client.fetchText("/active/");
  return {
    content: [{ type: "text" as const, text }],
  };
}

async function handleActiveFileUpdate(client: ObsidianClient, params: ActiveFileUpdateParams) {
  await client.fetchVoid("/active/", {
    method: "PUT",
    headers: { "Content-Type": "text/markdown" },
    body: params.content,
  });
  return {
    content: [{ type: "text" as const, text: "Arquivo ativo atualizado." }],
  };
}

async function handleActiveFileAppend(client: ObsidianClient, params: ActiveFileAppendParams) {
  await client.fetchVoid("/active/", {
    method: "POST",
    headers: { "Content-Type": "text/markdown" },
    body: params.content,
  });
  return {
    content: [{ type: "text" as const, text: "Conteúdo adicionado ao arquivo ativo." }],
  };
}

async function handleActiveFilePatch(client: ObsidianClient, params: ActiveFilePatchParams) {
  await client.fetchVoid("/active/", {
    method: "PATCH",
    headers: buildPatchHeaders(params),
    body: params.content,
  });
  return {
    content: [{ type: "text" as const, text: "Arquivo ativo atualizado no local especificado." }],
  };
}

async function handleActiveFileDelete(client: ObsidianClient) {
  await client.fetchVoid("/active/", { method: "DELETE" });
  return {
    content: [{ type: "text" as const, text: "Arquivo ativo removido." }],
  };
}

export function registerActiveFileTools(server: McpServer, client: ObsidianClient) {
  server.tool(
    "activeFileGet",
    "Retorna o conteúdo do arquivo atualmente aberto no Obsidian.",
    {},
    safeTool(() => handleActiveFileGet(client))
  );

  server.tool(
    "activeFileUpdate",
    "Substitui o conteúdo inteiro do arquivo ativo no Obsidian.",
    activeFileUpdateSchema,
    safeTool((params: ActiveFileUpdateParams) => handleActiveFileUpdate(client, params))
  );

  server.tool(
    "activeFileAppend",
    "Adiciona conteúdo ao final do arquivo ativo no Obsidian.",
    activeFileAppendSchema,
    safeTool((params: ActiveFileAppendParams) => handleActiveFileAppend(client, params))
  );

  server.tool(
    "activeFilePatch",
    "Insere conteúdo em um local específico do arquivo ativo (heading, block ou frontmatter).",
    activeFilePatchSchema,
    safeTool((params: ActiveFilePatchParams) => handleActiveFilePatch(client, params))
  );

  server.tool(
    "activeFileDelete",
    "Remove o arquivo atualmente aberto no Obsidian.",
    {},
    safeTool(() => handleActiveFileDelete(client))
  );
}
