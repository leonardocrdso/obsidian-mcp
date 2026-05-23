import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ObsidianClient } from "../../shared/obsidian-client.js";
import { safeTool } from "../../shared/errors.js";
import { PERIODS } from "./periodic.types.js";

const periodSchema = z.enum(PERIODS).describe("Período: daily, weekly, monthly, quarterly ou yearly");

const patchFields = {
  operation: z.enum(["append", "prepend", "replace"]).describe("Operação: append, prepend ou replace"),
  targetType: z.enum(["heading", "block", "frontmatter"]).describe("Tipo do alvo: heading, block ou frontmatter"),
  target: z.string().describe("Identificador do alvo"),
  targetDelimiter: z.string().optional().describe("Delimitador para separar conteúdo inserido"),
  trimTargetWhitespace: z.boolean().optional().describe("Remover espaços do target antes de comparar"),
  createTargetIfMissing: z.boolean().optional().describe("Criar o alvo se não existir no arquivo"),
};

const periodicGetNoteSchema = { period: periodSchema };
const periodicCreateNoteSchema = {
  period: periodSchema,
  content: z.string().describe("Conteúdo da nota periódica"),
};
const periodicAppendContentSchema = {
  period: periodSchema,
  content: z.string().describe("Conteúdo a adicionar ao final"),
};
const periodicPatchContentSchema = {
  period: periodSchema,
  content: z.string().describe("Conteúdo a inserir"),
  ...patchFields,
};
const periodicDeleteNoteSchema = { period: periodSchema };

type Period = (typeof PERIODS)[number];
type PeriodicGetNoteParams = { period: Period };
type PeriodicCreateNoteParams = { period: Period; content: string };
type PeriodicAppendContentParams = { period: Period; content: string };
type PeriodicPatchContentParams = {
  period: Period;
  content: string;
  operation: "append" | "prepend" | "replace";
  targetType: "heading" | "block" | "frontmatter";
  target: string;
  targetDelimiter?: string;
  trimTargetWhitespace?: boolean;
  createTargetIfMissing?: boolean;
};
type PeriodicDeleteNoteParams = { period: Period };

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

async function handlePeriodicGetNote(client: ObsidianClient, params: PeriodicGetNoteParams) {
  const text = await client.fetchText(`/periodic/${params.period}/`);
  return {
    content: [{ type: "text" as const, text }],
  };
}

async function handlePeriodicCreateNote(client: ObsidianClient, params: PeriodicCreateNoteParams) {
  await client.fetchVoid(`/periodic/${params.period}/`, {
    method: "PUT",
    headers: { "Content-Type": "text/markdown" },
    body: params.content,
  });
  return {
    content: [{ type: "text" as const, text: `Nota ${params.period} criada/atualizada.` }],
  };
}

async function handlePeriodicAppendContent(client: ObsidianClient, params: PeriodicAppendContentParams) {
  await client.fetchVoid(`/periodic/${params.period}/`, {
    method: "POST",
    headers: { "Content-Type": "text/markdown" },
    body: params.content,
  });
  return {
    content: [{ type: "text" as const, text: `Conteúdo adicionado à nota ${params.period}.` }],
  };
}

async function handlePeriodicPatchContent(client: ObsidianClient, params: PeriodicPatchContentParams) {
  await client.fetchVoid(`/periodic/${params.period}/`, {
    method: "PATCH",
    headers: buildPatchHeaders(params),
    body: params.content,
  });
  return {
    content: [{ type: "text" as const, text: `Nota ${params.period} atualizada no local especificado.` }],
  };
}

async function handlePeriodicDeleteNote(client: ObsidianClient, params: PeriodicDeleteNoteParams) {
  await client.fetchVoid(`/periodic/${params.period}/`, { method: "DELETE" });
  return {
    content: [{ type: "text" as const, text: `Nota ${params.period} removida.` }],
  };
}

export function registerPeriodicTools(server: McpServer, client: ObsidianClient) {
  server.tool(
    "periodicGetNote",
    "Retorna o conteúdo da nota periódica atual (daily, weekly, etc).",
    periodicGetNoteSchema,
    safeTool((params: PeriodicGetNoteParams) => handlePeriodicGetNote(client, params))
  );

  server.tool(
    "periodicCreateNote",
    "Cria ou substitui a nota periódica atual.",
    periodicCreateNoteSchema,
    safeTool((params: PeriodicCreateNoteParams) => handlePeriodicCreateNote(client, params))
  );

  server.tool(
    "periodicAppendContent",
    "Adiciona conteúdo ao final da nota periódica atual.",
    periodicAppendContentSchema,
    safeTool((params: PeriodicAppendContentParams) => handlePeriodicAppendContent(client, params))
  );

  server.tool(
    "periodicPatchContent",
    "Insere conteúdo em um local específico da nota periódica (heading, block ou frontmatter).",
    periodicPatchContentSchema,
    safeTool((params: PeriodicPatchContentParams) => handlePeriodicPatchContent(client, params))
  );

  server.tool(
    "periodicDeleteNote",
    "Remove a nota periódica atual.",
    periodicDeleteNoteSchema,
    safeTool((params: PeriodicDeleteNoteParams) => handlePeriodicDeleteNote(client, params))
  );
}
