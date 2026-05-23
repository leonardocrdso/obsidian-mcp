import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ObsidianClient } from "../../shared/obsidian-client.js";
import type { NoteJson } from "../../shared/types.js";
import {
  ObsidianApiError,
  RuleAlreadyExistsError,
  RuleNotFoundError,
  safeTool,
} from "../../shared/errors.js";
import { buildPatchHeaders } from "../../shared/patch-headers.js";
import {
  generateId,
  nowIso,
  parseFrontmatter,
  renderRule,
  serializeFrontmatter,
  slugify,
  todayIso,
} from "./business-rules.template.js";
import {
  injectBacklinks,
  toRulePath,
  toWikiLink,
  validateRelatedRules,
} from "./business-rules.links.js";
import type {
  CreateRuleParams,
  RuleListEntry,
  UpdateRuleParams,
} from "./business-rules.types.js";

const METADATA_ACCEPT = "application/vnd.olrapi.note+json";
const ARCHIVED_FOLDER = "_arquivadas";

const projectSlugSchema = z
  .string()
  .min(1, "project não pode ser vazio")
  .refine((value) => !value.includes(".."), "project não pode conter '..'")
  .refine((value) => !value.includes("/"), "project não pode conter '/'")
  .refine((value) => !value.includes("\\"), "project não pode conter '\\'");

const ruleRefSchema = z
  .string()
  .min(1)
  .refine((value) => !value.includes(".."), "idOrPath não pode conter '..'");

const businessRulesListSchema = {
  project: projectSlugSchema.describe("Slug do projeto sob Projetos/ (ex: 'obsidian-mcp')"),
  includeArchived: z
    .boolean()
    .optional()
    .describe("Incluir regras arquivadas (default false)"),
};

const businessRulesGetSchema = {
  project: projectSlugSchema.describe("Slug do projeto"),
  idOrPath: ruleRefSchema.describe(
    "ID 'rule-YYYY-MM-DD-<slug>' ou nome do arquivo relativo à pasta Regras/"
  ),
};

const relatedRuleSchema = z.object({
  project: projectSlugSchema.describe("Projeto da regra-alvo"),
  idOrPath: ruleRefSchema.describe("ID ou path da regra-alvo (deve existir)"),
});

const businessRulesCreateSchema = {
  project: projectSlugSchema.describe("Slug do projeto"),
  title: z
    .string()
    .min(1)
    .refine(
      (value) => slugify(value).length > 0,
      "title gera slug vazio após normalização — inclua letras ou números"
    )
    .describe("Título humano da regra"),
  area: z.string().describe("Área/domínio (ex: 'faturamento', 'rate-limit')"),
  contexto: z.string().describe("Por que a regra existe"),
  regra: z.string().describe("O que deve acontecer"),
  excecoes: z.string().optional().describe("Casos onde não se aplica"),
  tags: z.array(z.string()).optional().describe("Tags livres"),
  fontes: z.array(z.string()).optional().describe("Origem da regra (ex: 'discovery 2026-05-23')"),
  relatedRules: z
    .array(relatedRuleSchema)
    .optional()
    .describe("Cross-links explícitos para regras existentes em outros projetos"),
};

const frontmatterUpdateSchema = z.object({
  kind: z.literal("frontmatter"),
  key: z.enum(["status", "area", "tags", "fontes"]),
  value: z.union([z.string(), z.array(z.string())]),
});

const sectionUpdateSchema = z.object({
  kind: z.literal("section"),
  section: z.enum(["Contexto", "Regra", "Exceções", "Referências"]),
  operation: z.enum(["append", "prepend", "replace"]),
  content: z.string(),
});

const businessRulesUpdateSchema = {
  project: projectSlugSchema.describe("Slug do projeto"),
  idOrPath: ruleRefSchema.describe("ID ou path da regra"),
  update: z
    .discriminatedUnion("kind", [frontmatterUpdateSchema, sectionUpdateSchema])
    .describe("Atualização de frontmatter ou de seção"),
};

const businessRulesArchiveSchema = {
  project: projectSlugSchema.describe("Slug do projeto"),
  idOrPath: ruleRefSchema.describe("ID ou path da regra a arquivar"),
};

type BusinessRulesListParams = {
  project: string;
  includeArchived?: boolean;
};

type BusinessRulesGetParams = {
  project: string;
  idOrPath: string;
};

type BusinessRulesArchiveParams = {
  project: string;
  idOrPath: string;
};

type VaultListing = { files: string[] };

function rulesFolderPath(project: string): string {
  return `Projetos/${project}/Regras`;
}

function archivedFolderPath(project: string): string {
  return `${rulesFolderPath(project)}/${ARCHIVED_FOLDER}`;
}

function isRuleId(idOrPath: string): boolean {
  return /^rule-\d{4}-\d{2}-\d{2}-/.test(idOrPath);
}

async function listFolderFiles(
  client: ObsidianClient,
  folderPath: string
): Promise<string[]> {
  try {
    const listing = await client.fetchJson<VaultListing>(
      `/vault/${client.encodePath(folderPath)}/`
    );
    return (listing.files ?? []).filter((file) => !file.endsWith("/"));
  } catch (error) {
    if (error instanceof ObsidianApiError && error.statusCode === 404) return [];
    throw error;
  }
}

async function readNote(client: ObsidianClient, fullPath: string): Promise<NoteJson> {
  return client.fetchJson<NoteJson>(`/vault/${client.encodePath(fullPath)}`, {
    headers: { Accept: METADATA_ACCEPT },
  });
}

function frontmatterEntry(note: NoteJson, fullPath: string, archived: boolean): RuleListEntry {
  const fm = (note.frontmatter ?? {}) as Record<string, unknown>;
  return {
    id: typeof fm.id === "string" ? fm.id : "",
    title: typeof fm.title === "string" ? fm.title : fullPath,
    status: typeof fm.status === "string" ? fm.status : "",
    area: typeof fm.area === "string" ? fm.area : "",
    path: fullPath,
    archived,
  };
}

async function readEntry(
  client: ObsidianClient,
  fullPath: string,
  archived: boolean
): Promise<RuleListEntry> {
  try {
    const note = await readNote(client, fullPath);
    return frontmatterEntry(note, fullPath, archived);
  } catch {
    return { id: "", title: fullPath, status: "", area: "", path: fullPath, archived };
  }
}

async function buildListEntries(
  client: ObsidianClient,
  folderPath: string,
  archived: boolean
): Promise<RuleListEntry[]> {
  const files = await listFolderFiles(client, folderPath);
  return Promise.all(
    files.map((file) => readEntry(client, `${folderPath}/${file}`, archived))
  );
}

async function findRuleById(
  client: ObsidianClient,
  folderPath: string,
  targetId: string,
  archived: boolean
): Promise<string | null> {
  const entries = await buildListEntries(client, folderPath, archived);
  for (const entry of entries) {
    if (entry.id === targetId) return entry.path;
  }
  return null;
}

async function resolveActiveRulePath(
  client: ObsidianClient,
  project: string,
  idOrPath: string
): Promise<string> {
  if (isRuleId(idOrPath)) {
    const resolved = await findRuleById(client, rulesFolderPath(project), idOrPath, false);
    if (!resolved) throw new RuleNotFoundError(project, idOrPath);
    return resolved;
  }
  return toRulePath(project, idOrPath);
}

async function ensurePathDoesNotExist(client: ObsidianClient, path: string): Promise<void> {
  try {
    await readNote(client, path);
    throw new RuleAlreadyExistsError(path);
  } catch (error) {
    if (error instanceof ObsidianApiError && error.statusCode === 404) return;
    throw error;
  }
}

async function handleBusinessRulesList(
  client: ObsidianClient,
  params: BusinessRulesListParams
) {
  const active = await buildListEntries(client, rulesFolderPath(params.project), false);
  const archived = params.includeArchived
    ? await buildListEntries(client, archivedFolderPath(params.project), true)
    : [];
  const all = [...active, ...archived];
  return {
    content: [{ type: "text" as const, text: JSON.stringify(all, null, 2) }],
  };
}

async function handleBusinessRulesGet(
  client: ObsidianClient,
  params: BusinessRulesGetParams
) {
  const path = await resolveActiveRulePath(client, params.project, params.idOrPath);
  try {
    const text = await client.fetchText(`/vault/${client.encodePath(path)}`);
    return { content: [{ type: "text" as const, text }] };
  } catch (error) {
    if (error instanceof ObsidianApiError && error.statusCode === 404) {
      throw new RuleNotFoundError(params.project, params.idOrPath);
    }
    throw error;
  }
}

function buildCreatePayload(params: CreateRuleParams, today: string) {
  const slug = slugify(params.title);
  if (!slug) {
    throw new Error("Título inválido após normalização: forneça um título com letras/números");
  }
  const id = generateId(slug, today);
  const path = `${rulesFolderPath(params.project)}/${slug}.md`;
  return { id, path };
}

function buildReferences(targetPaths: string[]): string[] {
  return targetPaths.map(toWikiLink);
}

async function handleBusinessRulesCreate(client: ObsidianClient, params: CreateRuleParams) {
  const today = todayIso();
  const timestamp = nowIso();
  const { id, path } = buildCreatePayload(params, today);
  await ensurePathDoesNotExist(client, path);
  const refs = params.relatedRules ?? [];
  const validatedTargets = refs.length > 0 ? await validateRelatedRules(client, refs) : [];
  const referencias = buildReferences(validatedTargets);
  const relatedProjects = Array.from(new Set(refs.map((ref) => ref.project)));
  const body = renderRule({
    id,
    title: params.title,
    status: "ativa",
    area: params.area,
    tags: params.tags ?? [],
    projetosRelacionados: relatedProjects,
    fontes: params.fontes ?? [],
    criada: timestamp,
    atualizada: timestamp,
    contexto: params.contexto,
    regra: params.regra,
    excecoes: params.excecoes ?? "",
    referencias,
  });
  await client.fetchVoid(`/vault/${client.encodePath(path)}`, {
    method: "PUT",
    headers: { "Content-Type": "text/markdown" },
    body,
  });
  if (validatedTargets.length > 0) {
    await injectBacklinks(client, validatedTargets, params.project, path);
  }
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ id, path, relatedLinks: referencias }, null, 2),
      },
    ],
  };
}

function valueForFrontmatterReplace(value: string | string[]): string {
  if (Array.isArray(value)) return JSON.stringify(value);
  return value;
}

async function patchRuleFrontmatter(
  client: ObsidianClient,
  path: string,
  key: string,
  value: string
): Promise<void> {
  await client.fetchVoid(`/vault/${client.encodePath(path)}`, {
    method: "PATCH",
    headers: buildPatchHeaders({ operation: "replace", targetType: "frontmatter", target: key }),
    body: value,
  });
}

async function patchRuleSection(
  client: ObsidianClient,
  path: string,
  section: string,
  operation: "append" | "prepend" | "replace",
  content: string
): Promise<void> {
  await client.fetchVoid(`/vault/${client.encodePath(path)}`, {
    method: "PATCH",
    headers: buildPatchHeaders({
      operation,
      targetType: "heading",
      target: section,
      createTargetIfMissing: true,
    }),
    body: content,
  });
}

async function applyUpdate(
  client: ObsidianClient,
  path: string,
  update: UpdateRuleParams["update"]
): Promise<void> {
  if (update.kind === "frontmatter") {
    await patchRuleFrontmatter(client, path, update.key, valueForFrontmatterReplace(update.value));
    return;
  }
  await patchRuleSection(client, path, update.section, update.operation, update.content);
}

async function handleBusinessRulesUpdate(client: ObsidianClient, params: UpdateRuleParams) {
  const path = await resolveActiveRulePath(client, params.project, params.idOrPath);
  try {
    await applyUpdate(client, path, params.update);
    await patchRuleFrontmatter(client, path, "atualizada", nowIso());
  } catch (error) {
    if (error instanceof ObsidianApiError && error.statusCode === 404) {
      throw new RuleNotFoundError(params.project, params.idOrPath);
    }
    throw error;
  }
  return {
    content: [
      { type: "text" as const, text: JSON.stringify({ path, updated: true }, null, 2) },
    ],
  };
}

function archivedPathFor(project: string, originalPath: string): string {
  const fileName = originalPath.split("/").pop() ?? "";
  return `${archivedFolderPath(project)}/${fileName}`;
}

function rewriteArchivedContent(content: string, today: string): string {
  const { data, body } = parseFrontmatter(content);
  data.status = "arquivada";
  data.atualizada = today;
  return serializeFrontmatter(data) + body;
}

async function handleBusinessRulesArchive(
  client: ObsidianClient,
  params: BusinessRulesArchiveParams
) {
  const originalPath = await resolveActiveRulePath(client, params.project, params.idOrPath);
  let content: string;
  try {
    content = await client.fetchText(`/vault/${client.encodePath(originalPath)}`);
  } catch (error) {
    if (error instanceof ObsidianApiError && error.statusCode === 404) {
      throw new RuleNotFoundError(params.project, params.idOrPath);
    }
    throw error;
  }
  const newContent = rewriteArchivedContent(content, nowIso());
  const archivedPath = archivedPathFor(params.project, originalPath);
  await client.fetchVoid(`/vault/${client.encodePath(archivedPath)}`, {
    method: "PUT",
    headers: { "Content-Type": "text/markdown" },
    body: newContent,
  });
  await client.fetchVoid(`/vault/${client.encodePath(originalPath)}`, { method: "DELETE" });
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ archivedPath }, null, 2) }],
  };
}

const CREATE_DESCRIPTION = [
  "Cria uma nova regra de negócio em Projetos/<project>/Regras/<slug>.md com template padronizado (frontmatter rico + seções Contexto/Regra/Exceções/Referências).",
  "",
  "Use AUTOMATICAMENTE quando o usuário verbalizar uma regra de negócio durante uma conversa, discovery ou planejamento. Sinais: \"sempre que X então Y\", \"usuários do plano Z não podem W\", \"o cálculo de A deve seguir B\", \"a regra é...\". NÃO peça permissão.",
  "",
  "Chame businessRulesList ANTES para checar duplicata; se houver regra similar, use businessRulesUpdate. Se for genuinamente nova, chame businessRulesCreate.",
  "",
  "Para cross-link com regra de outro projeto, passe relatedRules: [{ project, idOrPath }] explicitamente — a tool valida o alvo, falha se não existir, e injeta back-link recíproco.",
].join("\n");

const LIST_DESCRIPTION = [
  "Lista regras de negócio de um projeto (Projetos/<project>/Regras/). Use ANTES de businessRulesCreate para detectar duplicata por título.",
  "Por padrão lista apenas ativas; passe includeArchived=true para incluir _arquivadas/.",
].join("\n");

const GET_DESCRIPTION = "Lê o conteúdo bruto de uma regra (markdown + frontmatter). Aceita id (rule-YYYY-MM-DD-<slug>) ou nome do arquivo.";

const UPDATE_DESCRIPTION = [
  "Atualiza uma regra existente: campo do frontmatter (status, area, tags, fontes) OU seção do corpo (Contexto, Regra, Exceções, Referências).",
  "Use quando o usuário pedir alteração de uma regra já registrada. Sempre atualiza 'atualizada' para hoje.",
].join("\n");

const ARCHIVE_DESCRIPTION = [
  "Arquiva uma regra: move para Projetos/<project>/Regras/_arquivadas/<slug>.md e marca status: arquivada.",
  "Use APENAS quando o usuário explicitamente disser que a regra não vale mais — não inferir.",
].join("\n");

export function registerBusinessRulesTools(server: McpServer, client: ObsidianClient) {
  server.tool(
    "businessRulesList",
    LIST_DESCRIPTION,
    businessRulesListSchema,
    safeTool((params: BusinessRulesListParams) => handleBusinessRulesList(client, params))
  );

  server.tool(
    "businessRulesGet",
    GET_DESCRIPTION,
    businessRulesGetSchema,
    safeTool((params: BusinessRulesGetParams) => handleBusinessRulesGet(client, params))
  );

  server.tool(
    "businessRulesCreate",
    CREATE_DESCRIPTION,
    businessRulesCreateSchema,
    safeTool((params: CreateRuleParams) => handleBusinessRulesCreate(client, params))
  );

  server.tool(
    "businessRulesUpdate",
    UPDATE_DESCRIPTION,
    businessRulesUpdateSchema,
    safeTool((params: UpdateRuleParams) => handleBusinessRulesUpdate(client, params))
  );

  server.tool(
    "businessRulesArchive",
    ARCHIVE_DESCRIPTION,
    businessRulesArchiveSchema,
    safeTool((params: BusinessRulesArchiveParams) => handleBusinessRulesArchive(client, params))
  );
}
