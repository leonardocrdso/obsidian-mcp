import type { ObsidianClient } from "../../shared/obsidian-client.js";
import { ObsidianApiError, RelatedRuleNotFoundError } from "../../shared/errors.js";
import { buildPatchHeaders } from "../../shared/patch-headers.js";
import { todayIso } from "./business-rules.template.js";
import type { RelatedRuleRef } from "./business-rules.types.js";
import type { NoteJson } from "../../shared/types.js";

const RULES_FOLDER = "Regras";
const METADATA_ACCEPT = "application/vnd.olrapi.note+json";

type VaultListing = { files: string[] };

function rulesFolderPath(project: string): string {
  return `Projetos/${project}/${RULES_FOLDER}`;
}

export function toRulePath(project: string, slugOrFile: string): string {
  const file = slugOrFile.endsWith(".md") ? slugOrFile : `${slugOrFile}.md`;
  return `${rulesFolderPath(project)}/${file}`;
}

export function toWikiLink(rulePath: string): string {
  const withoutExt = rulePath.replace(/\.md$/, "");
  return `[[${withoutExt}]]`;
}

function isRuleId(idOrPath: string): boolean {
  return /^rule-\d{4}-\d{2}-\d{2}-/.test(idOrPath);
}

async function fetchFolderEntries(
  client: ObsidianClient,
  folderPath: string
): Promise<string[]> {
  try {
    const listing = await client.fetchJson<VaultListing>(
      `/vault/${client.encodePath(folderPath)}/`
    );
    return listing.files ?? [];
  } catch (error) {
    if (error instanceof ObsidianApiError && error.statusCode === 404) return [];
    throw error;
  }
}

async function readRuleId(client: ObsidianClient, fullPath: string): Promise<string | null> {
  try {
    const note = await client.fetchJson<NoteJson>(
      `/vault/${client.encodePath(fullPath)}`,
      { headers: { Accept: METADATA_ACCEPT } }
    );
    const frontmatter = note.frontmatter as Record<string, unknown> | undefined;
    const id = frontmatter?.id;
    return typeof id === "string" ? id : null;
  } catch {
    return null;
  }
}

async function findRuleByIdInProject(
  client: ObsidianClient,
  project: string,
  targetId: string
): Promise<string | null> {
  const files = await fetchFolderEntries(client, rulesFolderPath(project));
  for (const file of files) {
    if (file.endsWith("/")) continue;
    const fullPath = toRulePath(project, file);
    const id = await readRuleId(client, fullPath);
    if (id === targetId) return fullPath;
  }
  return null;
}

export async function resolveRulePathFromRef(
  client: ObsidianClient,
  ref: RelatedRuleRef
): Promise<string | null> {
  if (isRuleId(ref.idOrPath)) {
    return findRuleByIdInProject(client, ref.project, ref.idOrPath);
  }
  return toRulePath(ref.project, ref.idOrPath);
}

async function ensureRuleExists(client: ObsidianClient, rulePath: string): Promise<void> {
  await client.fetchJson<NoteJson>(`/vault/${client.encodePath(rulePath)}`, {
    headers: { Accept: METADATA_ACCEPT },
  });
}

export async function validateRelatedRules(
  client: ObsidianClient,
  refs: RelatedRuleRef[]
): Promise<string[]> {
  const validated: string[] = [];
  for (const ref of refs) {
    const resolvedPath = await resolveRulePathFromRef(client, ref);
    if (!resolvedPath) {
      throw new RelatedRuleNotFoundError(ref.project, ref.idOrPath);
    }
    try {
      await ensureRuleExists(client, resolvedPath);
    } catch (error) {
      if (error instanceof ObsidianApiError && error.statusCode === 404) {
        throw new RelatedRuleNotFoundError(ref.project, ref.idOrPath);
      }
      throw error;
    }
    validated.push(resolvedPath);
  }
  return validated;
}

async function patchSectionAppend(
  client: ObsidianClient,
  rulePath: string,
  section: string,
  content: string
): Promise<void> {
  await client.fetchVoid(`/vault/${client.encodePath(rulePath)}`, {
    method: "PATCH",
    headers: buildPatchHeaders({
      operation: "append",
      targetType: "heading",
      target: section,
      createTargetIfMissing: true,
    }),
    body: content,
  });
}

async function patchFrontmatterReplace(
  client: ObsidianClient,
  rulePath: string,
  key: string,
  value: string
): Promise<void> {
  await client.fetchVoid(`/vault/${client.encodePath(rulePath)}`, {
    method: "PATCH",
    headers: buildPatchHeaders({
      operation: "replace",
      targetType: "frontmatter",
      target: key,
    }),
    body: value,
  });
}

async function readRelatedProjects(
  client: ObsidianClient,
  rulePath: string
): Promise<string[]> {
  const note = await client.fetchJson<NoteJson>(
    `/vault/${client.encodePath(rulePath)}`,
    { headers: { Accept: METADATA_ACCEPT } }
  );
  const frontmatter = note.frontmatter as Record<string, unknown> | undefined;
  const current = frontmatter?.projetos_relacionados;
  if (Array.isArray(current)) return current.map(String);
  return [];
}

function mergeProjects(current: string[], newProject: string): string[] {
  if (current.includes(newProject)) return current;
  return [...current, newProject];
}

async function updateRelatedProjects(
  client: ObsidianClient,
  rulePath: string,
  newProject: string
): Promise<void> {
  const current = await readRelatedProjects(client, rulePath);
  const merged = mergeProjects(current, newProject);
  await patchFrontmatterReplace(
    client,
    rulePath,
    "projetos_relacionados",
    JSON.stringify(merged)
  );
}

export async function injectBacklinks(
  client: ObsidianClient,
  targetPaths: string[],
  sourceProject: string,
  sourceRulePath: string
): Promise<void> {
  const sourceLink = toWikiLink(sourceRulePath);
  const today = todayIso();
  for (const target of targetPaths) {
    await patchSectionAppend(client, target, "Referências", `- ${sourceLink}\n`);
    await updateRelatedProjects(client, target, sourceProject);
    await patchFrontmatterReplace(client, target, "atualizada", today);
  }
}
