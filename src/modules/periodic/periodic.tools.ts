import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ObsidianClient } from "../../shared/obsidian-client.js";
import { safeTool } from "../../shared/errors.js";
import { buildPatchHeaders } from "../../shared/patch-headers.js";
import { PERIODS } from "./periodic.types.js";

const periodSchema = z.enum(PERIODS).describe("Período: daily, weekly, monthly, quarterly ou yearly");

const dateFields = {
  year: z.number().int().optional().describe("Ano da data alvo (use junto com month e day para nota datada)"),
  month: z.number().int().min(1).max(12).optional().describe("Mês 1-12 da data alvo"),
  day: z.number().int().min(1).max(31).optional().describe("Dia 1-31 da data alvo"),
};

const patchFields = {
  operation: z.enum(["append", "prepend", "replace"]).describe("Operação: append, prepend ou replace"),
  targetType: z.enum(["heading", "block", "frontmatter"]).describe("Tipo do alvo: heading, block ou frontmatter"),
  target: z.string().describe("Identificador do alvo"),
  targetDelimiter: z.string().optional().describe("Delimitador para separar conteúdo inserido"),
  trimTargetWhitespace: z.boolean().optional().describe("Remover espaços do target antes de comparar"),
  createTargetIfMissing: z.boolean().optional().describe("Criar o alvo se não existir no arquivo"),
  targetScope: z
    .enum(["content", "marker", "markerAndContent"])
    .optional()
    .describe("Escopo do alvo: content (default), marker ou markerAndContent"),
};

const periodicGetNoteSchema = { period: periodSchema, ...dateFields };
const periodicCreateNoteSchema = {
  period: periodSchema,
  content: z.string().describe("Conteúdo da nota periódica"),
  ...dateFields,
};
const periodicAppendContentSchema = {
  period: periodSchema,
  content: z.string().describe("Conteúdo a adicionar ao final"),
  ...dateFields,
};
const periodicPatchContentSchema = {
  period: periodSchema,
  content: z.string().describe("Conteúdo a inserir"),
  ...patchFields,
  ...dateFields,
};
const periodicDeleteNoteSchema = { period: periodSchema, ...dateFields };

type Period = (typeof PERIODS)[number];
type DateParts = { year?: number; month?: number; day?: number };
type PeriodicGetNoteParams = { period: Period } & DateParts;
type PeriodicCreateNoteParams = { period: Period; content: string } & DateParts;
type PeriodicAppendContentParams = { period: Period; content: string } & DateParts;
type PeriodicPatchContentParams = {
  period: Period;
  content: string;
  operation: "append" | "prepend" | "replace";
  targetType: "heading" | "block" | "frontmatter";
  target: string;
  targetDelimiter?: string;
  trimTargetWhitespace?: boolean;
  createTargetIfMissing?: boolean;
  targetScope?: "content" | "marker" | "markerAndContent";
} & DateParts;
type PeriodicDeleteNoteParams = { period: Period } & DateParts;

function resolvePath(params: { period: Period } & DateParts): string {
  const { period, year, month, day } = params;
  const provided = [year, month, day].filter((v) => v !== undefined).length;
  if (provided === 0) return `/periodic/${period}/`;
  if (provided !== 3) {
    throw new Error(
      "Parâmetros year, month e day devem ser informados juntos (ou nenhum) para selecionar uma data específica."
    );
  }
  return `/periodic/${period}/${year}/${month}/${day}/`;
}

function describeTarget(params: { period: Period } & DateParts): string {
  if (params.year !== undefined) {
    return `${params.period} (${params.year}-${String(params.month).padStart(2, "0")}-${String(params.day).padStart(2, "0")})`;
  }
  return `${params.period} atual`;
}

async function handlePeriodicGetNote(client: ObsidianClient, params: PeriodicGetNoteParams) {
  const text = await client.fetchText(resolvePath(params));
  return {
    content: [{ type: "text" as const, text }],
  };
}

async function handlePeriodicCreateNote(client: ObsidianClient, params: PeriodicCreateNoteParams) {
  await client.fetchVoid(resolvePath(params), {
    method: "PUT",
    headers: { "Content-Type": "text/markdown" },
    body: params.content,
  });
  return {
    content: [{ type: "text" as const, text: `Nota ${describeTarget(params)} criada/atualizada.` }],
  };
}

async function handlePeriodicAppendContent(client: ObsidianClient, params: PeriodicAppendContentParams) {
  await client.fetchVoid(resolvePath(params), {
    method: "POST",
    headers: { "Content-Type": "text/markdown" },
    body: params.content,
  });
  return {
    content: [{ type: "text" as const, text: `Conteúdo adicionado à nota ${describeTarget(params)}.` }],
  };
}

async function handlePeriodicPatchContent(client: ObsidianClient, params: PeriodicPatchContentParams) {
  await client.fetchVoid(resolvePath(params), {
    method: "PATCH",
    headers: buildPatchHeaders(params),
    body: params.content,
  });
  return {
    content: [{ type: "text" as const, text: `Nota ${describeTarget(params)} atualizada no local especificado.` }],
  };
}

async function handlePeriodicDeleteNote(client: ObsidianClient, params: PeriodicDeleteNoteParams) {
  await client.fetchVoid(resolvePath(params), { method: "DELETE" });
  return {
    content: [{ type: "text" as const, text: `Nota ${describeTarget(params)} removida.` }],
  };
}

export function registerPeriodicTools(server: McpServer, client: ObsidianClient) {
  server.tool(
    "periodicGetNote",
    "Retorna o conteúdo da nota periódica (daily, weekly, etc). Sem year/month/day usa a nota atual; com os três usa a data específica.",
    periodicGetNoteSchema,
    safeTool((params: PeriodicGetNoteParams) => handlePeriodicGetNote(client, params))
  );

  server.tool(
    "periodicCreateNote",
    "Cria ou substitui uma nota periódica (atual por default; informe year/month/day para data específica).",
    periodicCreateNoteSchema,
    safeTool((params: PeriodicCreateNoteParams) => handlePeriodicCreateNote(client, params))
  );

  server.tool(
    "periodicAppendContent",
    "Adiciona conteúdo ao final da nota periódica (atual ou de uma data específica).",
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
    "Remove a nota periódica (atual por default; informe year/month/day para data específica).",
    periodicDeleteNoteSchema,
    safeTool((params: PeriodicDeleteNoteParams) => handlePeriodicDeleteNote(client, params))
  );
}
