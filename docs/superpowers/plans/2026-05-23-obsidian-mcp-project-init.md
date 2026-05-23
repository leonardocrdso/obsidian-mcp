# `projectInit` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new MCP tool `projectInit` that bootstraps an effective project structure inside the connected Obsidian vault (folder + `CLAUDE.md` + three subfolders seeded with `README.md`), idempotently.

**Architecture:** New module `src/modules/project/` following the existing 5-module pattern. The tool probes each target path via GET, and creates only what is missing (probe-then-PUT). Reuses the existing `ObsidianClient` and `safeTool` infrastructure.

**Tech Stack:** TypeScript, `@modelcontextprotocol/sdk`, `zod`, Bun, the existing Local REST API client.

**Note on tests:** the project has no automated test suite — see `package.json`. The spec (`docs/superpowers/specs/2026-05-23-obsidian-mcp-init-design.md`) explicitly opts for **manual validation**. This plan respects that and does not introduce a test framework as a side effect.

**Parallelism:** Tasks 1 and 2 touch independent files (`project.types.ts` and `project.templates.ts`) and can be implemented in parallel. Task 3 depends on both. Task 4 (`project/index.ts`) is trivial and can run alongside Task 5 (`src/index.ts` wiring). Task 6 is sequential (build + manual validation).

---

## File Structure

```
src/modules/project/
├── index.ts              # re-export registerProjectTools
├── project.types.ts      # ProjectInitParams + ProjectInitResult + FileSeed types
├── project.templates.ts  # template strings + buildClaudeMd(projectName, description)
└── project.tools.ts      # zod schema, validation, handler, registerProjectTools
```

Plus one modification to `src/index.ts` to wire the new module.

---

## Task 1: Define types

**Files:**
- Create: `src/modules/project/project.types.ts`

- [ ] **Step 1: Create types file**

```ts
export type ProjectInitParams = {
  projectName: string;
  description?: string;
  basePath?: string;
};

export type FileSeed = {
  key: "claudeMd" | "regras" | "decisoes" | "notas";
  path: string;
  content: string;
};

export type ProjectInitResult = {
  basePath: string;
  projectName: string;
  rootPath: string;
  created: string[];
  alreadyExisted: string[];
  paths: {
    claudeMd: string;
    regras: string;
    decisoes: string;
    notas: string;
  };
};
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/project/project.types.ts
git commit -m "feat(project): adicionar tipos do projectInit"
```

---

## Task 2: Define templates

**Files:**
- Create: `src/modules/project/project.templates.ts`

- [ ] **Step 1: Create templates file**

```ts
const CLAUDE_MD_DEFAULT_DESCRIPTION = "_Adicione descrição aqui._";

const CLAUDE_MD_BODY = [
  "## Estrutura",
  "",
  "- `Regras/` — regras de negócio (um arquivo por regra; use slug + timestamp)",
  "- `Decisões/` — ADRs (um arquivo por decisão)",
  "- `Notas/` — inbox de anotações",
  "",
  "## Stack",
  "",
  "## Links",
  "",
].join("\n");

export function buildClaudeMd(projectName: string, description: string): string {
  const desc = description.trim().length > 0 ? description.trim() : CLAUDE_MD_DEFAULT_DESCRIPTION;
  return [`# ${projectName}`, "", desc, "", CLAUDE_MD_BODY].join("\n");
}

export const REGRAS_README = [
  "# Regras de Negócio",
  "",
  "Cada regra fica em seu próprio arquivo `<slug>.md` para evitar conflitos entre sessões concorrentes.",
  "",
  "Convenção de nome: `<slug-curto>.md` ou `<YYYY-MM-DD>-<slug>.md`.",
  "",
].join("\n");

export const DECISOES_README = [
  "# Decisões (ADRs)",
  "",
  "Cada decisão arquitetural fica em seu próprio arquivo.",
  "",
  "Convenção de nome: `<YYYY-MM-DD>-<slug>.md`.",
  "",
].join("\n");

export const NOTAS_README = [
  "# Notas",
  "",
  "Inbox de anotações livres do projeto. Sem estrutura imposta.",
  "",
].join("\n");
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/project/project.templates.ts
git commit -m "feat(project): adicionar templates do projectInit"
```

---

## Task 3: Implement the tool

**Files:**
- Create: `src/modules/project/project.tools.ts`

**Depends on:** Task 1, Task 2.

- [ ] **Step 1: Create tool file**

```ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ObsidianClient } from "../../shared/obsidian-client.js";
import { ObsidianApiError, safeTool } from "../../shared/errors.js";
import type { FileSeed, ProjectInitParams, ProjectInitResult } from "./project.types.js";
import {
  buildClaudeMd,
  DECISOES_README,
  NOTAS_README,
  REGRAS_README,
} from "./project.templates.js";

const projectNameSchema = z
  .string()
  .min(1, "projectName não pode ser vazio")
  .refine((value) => !value.includes(".."), "projectName não pode conter '..'")
  .refine((value) => !value.includes("/"), "projectName não pode conter '/'")
  .refine((value) => !value.includes("\\"), "projectName não pode conter '\\'");

const basePathSchema = z
  .string()
  .min(1, "basePath não pode ser vazio")
  .refine((value) => !value.includes(".."), "basePath não pode conter '..'");

const projectInitSchema = {
  projectName: projectNameSchema.describe("Nome do projeto. Vira o nome da pasta dentro de basePath."),
  description: z.string().optional().describe("Descrição livre injetada no CLAUDE.md (opcional)."),
  basePath: basePathSchema.optional().describe("Pasta-raiz onde o projeto será criado. Default: 'Projetos'."),
};

const DEFAULT_BASE_PATH = "Projetos";

function buildSeeds(rootPath: string, projectName: string, description: string): FileSeed[] {
  return [
    { key: "claudeMd", path: `${rootPath}/CLAUDE.md`, content: buildClaudeMd(projectName, description) },
    { key: "regras", path: `${rootPath}/Regras/README.md`, content: REGRAS_README },
    { key: "decisoes", path: `${rootPath}/Decisões/README.md`, content: DECISOES_README },
    { key: "notas", path: `${rootPath}/Notas/README.md`, content: NOTAS_README },
  ];
}

async function fileExists(client: ObsidianClient, path: string): Promise<boolean> {
  try {
    await client.fetchText(`/vault/${client.encodePath(path)}`);
    return true;
  } catch (error) {
    if (error instanceof ObsidianApiError && error.statusCode === 404) return false;
    throw error;
  }
}

async function createFile(client: ObsidianClient, path: string, content: string): Promise<void> {
  await client.fetchVoid(`/vault/${client.encodePath(path)}`, {
    method: "PUT",
    headers: { "Content-Type": "text/markdown" },
    body: content,
  });
}

async function ensureSeed(
  client: ObsidianClient,
  seed: FileSeed,
  created: string[],
  alreadyExisted: string[]
): Promise<void> {
  const exists = await fileExists(client, seed.path);
  if (exists) {
    alreadyExisted.push(seed.path);
    return;
  }
  await createFile(client, seed.path, seed.content);
  created.push(seed.path);
}

async function handleProjectInit(
  client: ObsidianClient,
  params: ProjectInitParams
): Promise<{ content: { type: "text"; text: string }[] }> {
  const basePath = params.basePath ?? DEFAULT_BASE_PATH;
  const description = params.description ?? "";
  const rootPath = `${basePath}/${params.projectName}`;
  const seeds = buildSeeds(rootPath, params.projectName, description);
  const created: string[] = [];
  const alreadyExisted: string[] = [];

  for (const seed of seeds) {
    await ensureSeed(client, seed, created, alreadyExisted);
  }

  const result: ProjectInitResult = {
    basePath,
    projectName: params.projectName,
    rootPath,
    created,
    alreadyExisted,
    paths: {
      claudeMd: seeds[0].path,
      regras: seeds[1].path,
      decisoes: seeds[2].path,
      notas: seeds[3].path,
    },
  };

  return {
    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
  };
}

export function registerProjectTools(server: McpServer, client: ObsidianClient) {
  server.tool(
    "projectInit",
    [
      "Inicializa a estrutura de um projeto dentro do vault Obsidian.",
      "",
      "Cria <basePath>/<projectName>/ com CLAUDE.md + subpastas Regras/, Decisões/, Notas/ (cada uma com um README.md seed).",
      "Operação idempotente: arquivos que já existem não são tocados; o retorno indica o que foi criado vs já existia.",
      "Use sempre que iniciar um novo projeto que ainda não tenha estrutura no Obsidian.",
    ].join("\n"),
    projectInitSchema,
    safeTool((params: ProjectInitParams) => handleProjectInit(client, params))
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/project/project.tools.ts
git commit -m "feat(project): implementar tool projectInit com probe-then-PUT idempotente"
```

---

## Task 4: Module entrypoint (re-export)

**Files:**
- Create: `src/modules/project/index.ts`

**Depends on:** Task 3.

- [ ] **Step 1: Create index**

```ts
export { registerProjectTools } from "./project.tools.js";
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/project/index.ts
git commit -m "feat(project): exportar registerProjectTools"
```

---

## Task 5: Wire module in server entrypoint

**Files:**
- Modify: `src/index.ts:18-32`

**Depends on:** Task 4.

- [ ] **Step 1: Add import and registration**

The current `src/index.ts` ends the imports block with `registerPeriodicTools` and calls all five registers in sequence. Add a sixth import alphabetically near the others, and a sixth call after `registerPeriodicTools(server, client)`.

Add this import (between the existing `registerActiveFileTools` and `registerPeriodicTools` imports is fine, or right after the last one — order is not enforced):

```ts
import { registerProjectTools } from "./modules/project/index.js";
```

Add this call right after the last existing registration:

```ts
registerProjectTools(server, client);
```

After the edits, the relevant block of `src/index.ts` should look like:

```ts
import { registerVaultTools } from "./modules/vault/index.js";
import { registerCommandsTools } from "./modules/commands/index.js";
import { registerSearchTools } from "./modules/search/index.js";
import { registerActiveFileTools } from "./modules/active-file/index.js";
import { registerPeriodicTools } from "./modules/periodic/index.js";
import { registerProjectTools } from "./modules/project/index.js";

const server = new McpServer({
  name: "obsidian-mcp",
  version: "1.0.0",
});

const config = getConfig();
const client = new ObsidianClient(config.baseUrl, config.apiKey);

registerVaultTools(server, client);
registerCommandsTools(server, client);
registerSearchTools(server, client);
registerActiveFileTools(server, client);
registerPeriodicTools(server, client);
registerProjectTools(server, client);
```

- [ ] **Step 2: Commit**

```bash
git add src/index.ts
git commit -m "feat(server): registrar módulo project no servidor MCP"
```

---

## Task 6: Build + manual validation

**Files:** none (validation only).

**Depends on:** Tasks 1–5.

- [ ] **Step 1: Build**

Run:

```bash
bun run build
```

Expected: exits with code 0, no TypeScript errors. `build/index.js` is regenerated.

- [ ] **Step 2: Validate API surface in built artifact**

Run:

```bash
grep -c "projectInit" build/index.js
```

Expected: a positive integer (≥ 1). The tool name should appear in the bundled output.

- [ ] **Step 3: Run dev server pointing to a test vault**

Prerequisite: a local Obsidian vault for testing with the Local REST API plugin enabled, and a valid `~/.obsidian-mcp.json` (or `OBSIDIAN_API_KEY` env). If not configured: `bun run src/index.ts --setup` first.

Run:

```bash
bun run dev
```

Expected: stderr `Obsidian MCP server running on stdio`.

- [ ] **Step 4: Manual smoke test via any MCP client**

From any MCP client connected to the dev server, invoke:

1. `projectInit({ projectName: "test-init" })` — expected: all four paths in `created`, none in `alreadyExisted`. Confirm in the Obsidian app that the folder `Projetos/test-init/` exists with `CLAUDE.md` and `Regras/`, `Decisões/`, `Notas/` subfolders each containing `README.md`.

2. `projectInit({ projectName: "test-init" })` (same args, repeat) — expected: all four paths in `alreadyExisted`, none in `created`. No file is overwritten.

3. `projectInit({ projectName: "test-desc", description: "Projeto X de teste" })` — expected: `created` has all four paths. Open `Projetos/test-desc/CLAUDE.md` and confirm the description text appears.

4. `projectInit({ projectName: "test-base", basePath: "Sandbox" })` — expected: `created` paths start with `Sandbox/test-base/...`.

5. `projectInit({ projectName: "../escape" })` — expected: validation error from Zod ("projectName não pode conter '..'"). No file created.

- [ ] **Step 5: Cleanup test vault (optional)**

Delete the test folders (`Projetos/test-init`, `Projetos/test-desc`, `Sandbox/test-base`) directly in Obsidian.

- [ ] **Step 6: Final commit (only if any docs need touching)**

If steps above revealed any doc edits worth making (e.g., adding `projectInit` to the `Tools` table in `README.md`), commit them. Otherwise skip.

```bash
# example only — run if README was updated
git add README.md
git commit -m "docs(readme): documentar tool projectInit"
```

---

## Self-Review

**Spec coverage**
- ✅ Tool name, params, defaults → Tasks 1, 3.
- ✅ Structure (`CLAUDE.md` + 3 README seeds) → Tasks 2, 3.
- ✅ Templates (CLAUDE.md + per-folder README) → Task 2.
- ✅ Probe-then-PUT idempotency → Task 3 (`fileExists` + `ensureSeed`).
- ✅ Validation (Zod, no `..`, no `/`, no `\`) → Task 3 (`projectNameSchema`).
- ✅ `ObsidianApiError.statusCode === 404` for the probe → Task 3 (`fileExists`).
- ✅ Module placement → Tasks 1–4.
- ✅ Wire-up in `src/index.ts` → Task 5.
- ✅ Manual validation steps → Task 6.

**Placeholder scan**
- No TBD/TODO/"implement later" in any step. All code blocks are complete.

**Type consistency**
- `FileSeed.key` enum (`"claudeMd" | "regras" | "decisoes" | "notas"`) matches `ProjectInitResult.paths` keys and the `buildSeeds` return order/keys.
- `projectInitSchema` field names match `ProjectInitParams`.
- `registerProjectTools` signature matches the other module entrypoints (`server: McpServer, client: ObsidianClient`).
