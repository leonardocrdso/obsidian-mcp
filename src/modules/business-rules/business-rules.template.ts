import type { RenderRuleParams } from "./business-rules.types.js";

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function slugify(title: string): string {
  return title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

export function generateId(slug: string, today: string): string {
  return `rule-${today}-${slug}`;
}

function quoteIfNeeded(value: string): string {
  if (/[,:\[\]'"]/.test(value)) return `"${value.replace(/"/g, '\\"')}"`;
  return value;
}

function renderList(items: string[] | undefined): string {
  if (!items || items.length === 0) return "[]";
  return `[${items.map(quoteIfNeeded).join(", ")}]`;
}

function renderFrontmatter(params: RenderRuleParams): string {
  return [
    "---",
    `id: ${params.id}`,
    `title: ${params.title}`,
    `status: ${params.status}`,
    `area: ${params.area}`,
    `tags: ${renderList(params.tags)}`,
    `projetos_relacionados: ${renderList(params.projetosRelacionados)}`,
    `fontes: ${renderList(params.fontes)}`,
    `criada: ${params.criada}`,
    `atualizada: ${params.atualizada}`,
    "---",
    "",
  ].join("\n");
}

function renderSections(params: RenderRuleParams): string {
  const excecoes = params.excecoes || "Nenhuma identificada.";
  const referencias =
    params.referencias.length > 0
      ? params.referencias.map((ref) => `- ${ref}`).join("\n")
      : "";
  return [
    "## Contexto",
    params.contexto,
    "",
    "## Regra",
    params.regra,
    "",
    "## Exceções",
    excecoes,
    "",
    "## Referências",
    referencias,
  ].join("\n");
}

export function renderRule(params: RenderRuleParams): string {
  return renderFrontmatter(params) + renderSections(params) + "\n";
}

function stripQuotes(raw: string): string {
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
    return raw.slice(1, -1).replace(/\\"/g, '"');
  }
  return raw;
}

function parseYamlValue(raw: string): unknown {
  if (raw === "") return "";
  if (raw === "[]") return [];
  if (raw.startsWith("[") && raw.endsWith("]")) {
    return raw
      .slice(1, -1)
      .split(",")
      .map((item) => stripQuotes(item.trim()))
      .filter((item) => item.length > 0);
  }
  return stripQuotes(raw);
}

function parseSimpleYaml(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const rawLine of yaml.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    result[key] = parseYamlValue(value);
  }
  return result;
}

export function parseFrontmatter(content: string): {
  data: Record<string, unknown>;
  body: string;
} {
  if (!content.startsWith("---\n")) return { data: {}, body: content };
  const end = content.indexOf("\n---", 4);
  if (end === -1) return { data: {}, body: content };
  const yaml = content.slice(4, end);
  const body = content.slice(end + 4).replace(/^\n/, "");
  return { data: parseSimpleYaml(yaml), body };
}

function serializeYamlValue(value: unknown): string {
  if (Array.isArray(value)) return renderList(value.map(String));
  if (value === "" || value === undefined || value === null) return "";
  return quoteIfNeeded(String(value));
}

export function serializeFrontmatter(data: Record<string, unknown>): string {
  const lines = ["---"];
  for (const [key, value] of Object.entries(data)) {
    lines.push(`${key}: ${serializeYamlValue(value)}`);
  }
  lines.push("---", "");
  return lines.join("\n");
}
