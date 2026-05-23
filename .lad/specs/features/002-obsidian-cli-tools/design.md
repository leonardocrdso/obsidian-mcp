# Design — Obsidian CLI Tools (SPEC-002)

## Visão geral da arquitetura

```
                                   ┌──────────────────────────────┐
                                   │  MCP Server (stdio)          │
                                   │  src/index.ts                │
                                   └──────────┬───────────────────┘
                                              │
                  ┌───────────────────────────┼─────────────────────────────────────┐
                  │                           │                                     │
                  ▼                           ▼                                     ▼
        ┌──────────────────┐         ┌──────────────────┐                ┌─────────────────────┐
        │ getConfig()      │         │ ObsidianClient   │                │ ObsidianCliClient   │
        │ shared/config.ts │         │ (REST, HTTP)     │                │ (NEW, child_process)│
        │  + cliPath       │         │ shared/obsidian- │                │ shared/obsidian-    │
        │                  │         │ client.ts        │                │ cli.ts              │
        └──────────────────┘         └────────┬─────────┘                └─────────┬───────────┘
                                              │                                    │
                                              │ (22 tools antigas)                 │ (12 tools novas)
                                              │                                    │
        ┌─────────────────┬──────────────┬────┴───────┬───────────┐     ┌──────────┼──────────┬──────────┐
        ▼                 ▼              ▼            ▼           ▼     ▼          ▼          ▼          ▼
   ┌─────────┐      ┌──────────┐    ┌─────────┐  ┌─────────┐  ┌──────┐ ┌────────┐ ┌───────┐ ┌──────────┐ ┌──────┐
   │ vault/  │      │ periodic/│    │ active- │  │ commands│  │ proj │ │ file-  │ │ graph/│ │properties│ │tasks/│
   │ (8)     │      │ (5)      │    │ file/(5)│  │ /(2)    │  │ ect/ │ │ ops/(2)│ │ (4)   │ │ /(3)     │ │ (2)  │
   └─────────┘      └──────────┘    └─────────┘  └─────────┘  └──────┘ └────────┘ └───────┘ └──────────┘ └──────┘
                                                                                                          
                                              ┌──────────────────────┐
                                              │ search/ (2 + 1 nova) │
                                              │ usa client REST E    │
                                              │ cliClient            │
                                              └──────────────────────┘
```

Princípios estruturais:
- **Dois transports ortogonais.** REST e CLI. Cada client é uma classe independente. Nenhuma herança/composição entre eles.
- **Modular monolith mantido.** Cada novo domínio é um módulo (`file-ops/`, `graph/`, `properties/`, `tasks/`). Cada módulo recebe **um único client** (CLI no caso dos novos). Exceção: `search/` recebe os dois clients para servir `searchSimple`/`searchAdvanced` (REST) e `searchContext` (CLI) — exceção justificada por coesão semântica do domínio "busca".
- **Aditivo, nunca modificativo.** Código existente é preservado byte-a-byte fora do wiring mínimo (`index.ts`, parâmetro extra no `registerSearchTools`).

## Componentes novos

### 1. `src/shared/obsidian-cli.ts`

Wrapper sobre `node:child_process.spawn` com:
- Probe de disponibilidade cacheado.
- Run tipado com validação Zod.
- Run sem retorno.
- Erros tipados.

#### Interface pública

```ts
export class ObsidianCliClient {
  constructor(cliPath: string, defaults?: { timeoutMs?: number });
  isAvailable(): Promise<boolean>;
  get available(): boolean;
  run<T>(args: string[], schema: ZodSchema<T>): Promise<T>;
  runVoid(args: string[]): Promise<void>;
}

export class ObsidianCliError extends Error {
  constructor(public readonly command: string, public readonly exitCode: number, public readonly stderr: string);
}

export class ObsidianCliSchemaError extends Error {
  constructor(public readonly command: string, public readonly issues: string, public readonly stdoutSample: string);
}

export class ObsidianCliTimeoutError extends Error {
  constructor(public readonly command: string, public readonly timeoutMs: number);
}
```

#### Decomposição interna (funções privadas do arquivo)

Para respeitar `function-length` (<= 20 linhas) e `nesting-depth` (<= 4):

```
truncateCommand(cliPath, args) -> string         # <200 chars, sem shell-quoting
ensureFormatJson(args) -> string[]               # injeta "format=json" se faltar
spawnWithTimeout(cliPath, args, timeoutMs) -> { stdout, stderr, exitCode } | timeout
formatZodIssues(issues, max) -> string           # primeiros 3 issues
truncateStdout(stdout, max=200) -> string
```

Métodos da classe consumem essas funções em sequência linear, sem aninhamento profundo.

#### Probe `isAvailable()`

```
private cache: boolean | null = null;

async isAvailable(): Promise<boolean> {
  if (this.cache !== null) return this.cache;
  const result = await tryProbe(this.cliPath);  # spawn(--version), timeout 5s, captura tudo
  this.cache = result;
  return result;
}

get available(): boolean {
  if (this.cache === null) throw new Error("isAvailable() not called yet");
  return this.cache;
}
```

`tryProbe` nunca lança — captura tudo, retorna boolean.

#### Fluxo de `run<T>`

```
1. ensureFormatJson(args) → args com format=json
2. spawnWithTimeout(cliPath, args, timeoutMs)
3. Se timeout → throw ObsidianCliTimeoutError(command, timeoutMs)
4. Se exitCode !== 0 → throw ObsidianCliError(command, exitCode, stderr)
5. let parsed: unknown
   try { parsed = JSON.parse(stdout) }
   catch { throw ObsidianCliSchemaError(command, "stdout não é JSON válido", truncateStdout(stdout)) }
6. const result = schema.safeParse(parsed)
   Se !result.success → throw ObsidianCliSchemaError(command, formatZodIssues(result.error.issues, 3), truncateStdout(stdout))
7. return result.data
```

#### Fluxo de `runVoid`

```
1. spawnWithTimeout(cliPath, args, timeoutMs)
2. Se timeout → throw ObsidianCliTimeoutError
3. Se exitCode !== 0 → throw ObsidianCliError
4. return
```

#### Segurança

- **Sem shell.** `spawn(cliPath, args, { shell: false })`. Args são array; nunca string interpolada. Previne injection de shell metacharacters em paths/queries.
- **stdio explícito.** `stdio: ["ignore", "pipe", "pipe"]`. stdin fechado (não vamos enviar input ao CLI).
- **AbortController para timeout.** `const ac = new AbortController(); spawn(..., { signal: ac.signal })`. `setTimeout(() => ac.abort(), timeoutMs)`. Limpa o timer no resolve.

### 2. Módulo `src/modules/file-ops/`

Estrutura:
```
src/modules/file-ops/
├── index.ts            (re-exporta registerFileOpsTools)
├── file-ops.tools.ts   (handlers + schemas Zod input + registerFileOpsTools)
```

Tools:

**`vaultMoveFile { from: string, to: string }`**

```
const vaultMoveFileSchema = {
  from: z.string().describe("Path origem (ex.: 'Notes/A.md')"),
  to: z.string().describe("Path destino, incluindo pasta destino (ex.: 'Archive/A.md')"),
};

async function handleVaultMoveFile(cliClient: ObsidianCliClient, params: { from: string; to: string }) {
  if (!cliClient.available) return cliUnavailableResult();
  await cliClient.runVoid(["move", `file=${params.from}`, `to=${params.to}`]);
  return { content: [{ type: "text" as const, text: `Arquivo movido: ${params.from} → ${params.to}` }] };
}
```

**`vaultRenameFile { path: string, newName: string }`**

```
async function handleVaultRenameFile(cliClient: ObsidianCliClient, params: { path: string; newName: string }) {
  if (!cliClient.available) return cliUnavailableResult();
  await cliClient.runVoid(["rename", `file=${params.path}`, `name=${params.newName}`]);
  return { content: [{ type: "text" as const, text: `Arquivo renomeado: ${params.path} → ${params.newName}` }] };
}
```

Helper compartilhado (privado do arquivo ou em `shared/errors.ts`):
```
function cliUnavailableResult(): ToolResult {
  return {
    content: [{ type: "text" as const, text: CLI_UNAVAILABLE_MESSAGE }],
    isError: true,
  };
}
```

`CLI_UNAVAILABLE_MESSAGE` exportado de `src/shared/errors.ts` para reuso pelos 4 módulos novos + `search/`.

### 3. Módulo `src/modules/graph/`

Estrutura:
```
src/modules/graph/
├── index.ts
├── graph.tools.ts
├── graph.types.ts  (schemas Zod de retorno)
```

`graph.types.ts`:
```ts
import { z } from "zod";

export const BacklinkEntry = z.object({
  path: z.string(),
  line: z.number().optional(),
  context: z.string().optional(),
});

export const BacklinksResult = z.object({
  file: z.string(),
  backlinks: z.array(BacklinkEntry),
});

export const HeadingEntry = z.object({
  level: z.number().int().min(1).max(6),
  text: z.string(),
  line: z.number().int().nonnegative(),
});

export const OutlineResult = z.object({
  file: z.string(),
  headings: z.array(HeadingEntry),
});

export const UnresolvedLink = z.object({
  source: z.string(),
  target: z.string(),
  line: z.number().int().optional(),
});

export const UnresolvedLinksResult = z.object({
  links: z.array(UnresolvedLink),
});

export const OrphansResult = z.object({
  files: z.array(z.string()),
});
```

`graph.tools.ts` (resumido):
```
async function handleVaultBacklinks(cli, { path }) {
  if (!cli.available) return cliUnavailableResult();
  const data = await cli.run(["backlinks", `file=${path}`], BacklinksResult);
  return jsonResult(data);
}
async function handleVaultOutline(cli, { path }) { ... }
async function handleVaultUnresolvedLinks(cli) {
  if (!cli.available) return cliUnavailableResult();
  const data = await cli.run(["unresolved"], UnresolvedLinksResult);
  return jsonResult(data);
}
async function handleVaultOrphans(cli) { ... }
```

`jsonResult(data)` é helper local: `{ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] }`.

### 4. Módulo `src/modules/properties/`

```
src/modules/properties/
├── index.ts
├── properties.tools.ts
├── properties.types.ts
```

`properties.types.ts`:
```ts
export const PropertyValue = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.null(),
]);

export const PropertyType = z.enum(["text", "number", "checkbox", "list", "date"]);

export const PropertyReadResult = z.object({
  key: z.string(),
  value: PropertyValue,
  type: PropertyType,
});
```

Input schemas (em `properties.tools.ts`):
```ts
const propertyGetSchema = {
  path: z.string(),
  key: z.string(),
};

const propertySetSchema = {
  path: z.string(),
  key: z.string(),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]),
  type: z.enum(["text", "number", "checkbox", "list", "date"]).optional(),
};

const propertyRemoveSchema = {
  path: z.string(),
  key: z.string(),
};
```

Handler `handlePropertySet` constrói argv com helper `buildPropertySetArgs(params)` que isola a decisão de como serializar arrays. Implementação inicial: array → CSV (`value=a,b,c`). Se CLI real esperar outra convenção (`value=a value=b`), ajusta apenas esse helper.

```ts
function buildPropertySetArgs(params: PropertySetParams): string[] {
  const args = ["property:set", `file=${params.path}`, `key=${params.key}`];
  const value = Array.isArray(params.value) ? params.value.join(",") : String(params.value);
  args.push(`value=${value}`);
  if (params.type) args.push(`type=${params.type}`);
  return args;
}
```

### 5. Módulo `src/modules/tasks/`

```
src/modules/tasks/
├── index.ts
├── tasks.tools.ts
├── tasks.types.ts
```

`tasks.types.ts`:
```ts
export const TaskStatus = z.enum(["open", "done"]);

export const Task = z.object({
  ref: z.string(),
  text: z.string(),
  status: TaskStatus,
  path: z.string(),
  line: z.number().int(),
});

export const TasksListResult = z.object({
  tasks: z.array(Task),
});

export const TaskToggleResult = z.object({
  ref: z.string(),
  newStatus: TaskStatus,
});
```

Handler `handleTasksList`:
```ts
async function handleTasksList(cli, params: { path?: string; status?: "open" | "done" | "all" }) {
  if (!cli.available) return cliUnavailableResult();
  const args = ["tasks"];
  if (params.path) args.push(`file=${params.path}`);
  if (params.status) args.push(`status=${params.status}`);
  const data = await cli.run(args, TasksListResult);
  return jsonResult(data);
}
```

### 6. Extensão de `src/modules/search/search.tools.ts`

**Apenas adições.** O arquivo passa de 78 linhas para ~120. Diff esperado contém apenas linhas adicionadas.

Mudanças:
1. Novo import: `import type { ObsidianCliClient } from "../../shared/obsidian-cli.js";`
2. Novo import: `import { SearchContextResult } from "./search.types.js";` (extensão do arquivo de types existente).
3. Novo schema input: `const searchContextSchema = { query: z.string(), contextLines: z.number().int().min(0).max(20).optional() }`.
4. Novo handler `handleSearchContext`.
5. `registerSearchTools(server, client)` → `registerSearchTools(server, client, cliClient)`.
6. Nova chamada `server.tool("searchContext", ...)` no final de `registerSearchTools`.

`search.types.ts` ganha:
```ts
export const SearchContextMatch = z.object({
  path: z.string(),
  line: z.number().int(),
  before: z.array(z.string()),
  match: z.string(),
  after: z.array(z.string()),
});

export const SearchContextResult = z.object({
  matches: z.array(SearchContextMatch),
});
```

Sem remoção de exports existentes.

### 7. Extensão de `src/shared/errors.ts`

**Apenas adições.**

```ts
export const CLI_UNAVAILABLE_MESSAGE =
  "Obsidian CLI não disponível. Configure OBSIDIAN_CLI_PATH ou instale o Obsidian >= 1.12.7.";

export function cliUnavailableResult() {
  return {
    content: [{ type: "text" as const, text: CLI_UNAVAILABLE_MESSAGE }],
    isError: true,
  };
}

function resolveCliErrorMessage(error: ObsidianCliError): string {
  return [
    `[CLI] ${error.command}`,
    `Exit code: ${error.exitCode}`,
    error.stderr ? `Stderr: ${error.stderr.slice(0, 500)}` : "",
  ].filter(Boolean).join("\n");
}

function resolveCliSchemaMessage(error: ObsidianCliSchemaError): string {
  return [
    `[CLI] Schema inválido em: ${error.command}`,
    `Issues: ${error.issues}`,
    `Stdout (200 chars): ${error.stdoutSample}`,
  ].join("\n");
}

function resolveCliTimeoutMessage(error: ObsidianCliTimeoutError): string {
  return `[CLI] Timeout após ${error.timeoutMs}ms em: ${error.command}`;
}
```

`formatObsidianError` ganha 3 ramos novos no início (antes do ramo `ObsidianApiError`):
```ts
if (error instanceof ObsidianCliTimeoutError) return resolveCliTimeoutMessage(error);
if (error instanceof ObsidianCliSchemaError) return resolveCliSchemaMessage(error);
if (error instanceof ObsidianCliError) return resolveCliErrorMessage(error);
```

`safeCli` é alias: `export const safeCli = safeTool;`.

### 8. Extensão de `src/shared/config.ts` e `setup.ts`

`config.ts`:
```ts
function loadConfig() {
  const saved = loadSavedConfig();
  const fromEnv = process.env.OBSIDIAN_CLI_PATH;
  if (saved) {
    const baseUrl = `${saved.protocol}://${saved.host}:${saved.port}`;
    const cliPath = saved.cliPath ?? fromEnv ?? "obsidian";
    return { ...saved, baseUrl, cliPath } as const;
  }

  const apiKey = process.env.OBSIDIAN_API_KEY;
  if (apiKey) {
    const host = process.env.OBSIDIAN_HOST ?? "127.0.0.1";
    const port = process.env.OBSIDIAN_PORT ?? "27124";
    const protocol = process.env.OBSIDIAN_PROTOCOL ?? "https";
    const baseUrl = `${protocol}://${host}:${port}`;
    const cliPath = fromEnv ?? "obsidian";
    return { apiKey, host, port, protocol, baseUrl, cliPath } as const;
  }

  throw new Error("Obsidian MCP nao configurado. Execute: npx @leonardocrdso/obsidian-mcp --setup");
}
```

`setup.ts`:
- `SavedConfig` ganha `cliPath?: string`.
- `runSetup` adiciona `const cliPath = await ask("Caminho do CLI", existing?.cliPath ?? "obsidian");`.
- `saveConfig({ apiKey, host, port, protocol, cliPath })`.

### 9. Wiring em `src/index.ts`

Antes da chamada `await server.connect(transport)`, o bootstrap fica:

```ts
import { ObsidianCliClient } from "./shared/obsidian-cli.js";
import { registerFileOpsTools } from "./modules/file-ops/index.js";
import { registerGraphTools } from "./modules/graph/index.js";
import { registerPropertiesTools } from "./modules/properties/index.js";
import { registerTasksTools } from "./modules/tasks/index.js";

const config = getConfig();
const client = new ObsidianClient(config.baseUrl, config.apiKey);
const cliClient = new ObsidianCliClient(config.cliPath);
await cliClient.isAvailable();

registerVaultTools(server, client);
registerCommandsTools(server, client);
registerSearchTools(server, client, cliClient);
registerActiveFileTools(server, client);
registerPeriodicTools(server, client);
registerProjectTools(server, client);
registerFileOpsTools(server, cliClient);
registerGraphTools(server, cliClient);
registerPropertiesTools(server, cliClient);
registerTasksTools(server, cliClient);
```

## Contrato de cada tool nova

### vaultMoveFile

| Campo | Valor |
|---|---|
| Input | `{ from: string, to: string }` |
| CLI args | `["move", "file=<from>", "to=<to>"]` |
| Retorno | Texto: `Arquivo movido: <from> → <to>` |
| Erros | `ObsidianCliError` (CLI exit !=0), `ObsidianCliTimeoutError`, CLI ausente |

### vaultRenameFile

| Campo | Valor |
|---|---|
| Input | `{ path: string, newName: string }` |
| CLI args | `["rename", "file=<path>", "name=<newName>"]` |
| Retorno | Texto: `Arquivo renomeado: <path> → <newName>` |
| Erros | idem |

### vaultBacklinks

| Campo | Valor |
|---|---|
| Input | `{ path: string }` |
| CLI args | `["backlinks", "file=<path>", "format=json"]` |
| Schema retorno | `BacklinksResult` |
| Retorno | JSON do `BacklinksResult` |
| Erros | idem + `ObsidianCliSchemaError` |

### vaultOutline

| Input | `{ path: string }` |
| CLI args | `["outline", "file=<path>", "format=json"]` |
| Schema retorno | `OutlineResult` |

### vaultUnresolvedLinks

| Input | `{}` |
| CLI args | `["unresolved", "format=json"]` |
| Schema retorno | `UnresolvedLinksResult` |

### vaultOrphans

| Input | `{}` |
| CLI args | `["orphans", "format=json"]` |
| Schema retorno | `OrphansResult` |

### propertyGet

| Input | `{ path: string, key: string }` |
| CLI args | `["property:read", "file=<path>", "key=<key>", "format=json"]` |
| Schema retorno | `PropertyReadResult` |

### propertySet

| Input | `{ path: string, key: string, value: string|number|boolean|string[], type?: ... }` |
| CLI args | `["property:set", "file=<path>", "key=<key>", "value=<serialized>", optional "type=<type>"]` |
| Retorno | Texto: `Property atualizada: <key>=<value>` |

### propertyRemove

| Input | `{ path: string, key: string }` |
| CLI args | `["property:remove", "file=<path>", "key=<key>"]` |
| Retorno | Texto: `Property removida: <key>` |

### tasksList

| Input | `{ path?: string, status?: "open"|"done"|"all" }` |
| CLI args | `["tasks"]` + opcionalmente `file=<path>` + `status=<status>` + `format=json` |
| Schema retorno | `TasksListResult` |

### taskToggle

| Input | `{ ref: string }` |
| CLI args | `["task", "ref=<ref>", "toggle", "format=json"]` |
| Schema retorno | `TaskToggleResult` |

### searchContext

| Input | `{ query: string, contextLines?: number }` |
| CLI args | `["search:context", "query=<query>"]` + opcional `context=<contextLines>` + `format=json` |
| Schema retorno | `SearchContextResult` |

## Tratamento de erro: fluxo completo

```
Tool invocada
  │
  ├── safeCli(...)
  │     │
  │     ├── try
  │     │   ├── if (!cliClient.available) return cliUnavailableResult()
  │     │   └── await cliClient.run(...)
  │     │
  │     └── catch (error)
  │           └── return formatObsidianError(error) embrulhado em { isError: true, content: [...] }
  │
  └── Response MCP
```

`formatObsidianError` resolve a mensagem por tipo:
- `ObsidianCliTimeoutError` → `[CLI] Timeout após 30000ms em: obsidian backlinks file=A.md format=json`
- `ObsidianCliSchemaError` → `[CLI] Schema inválido em: ...\nIssues: ...\nStdout (200 chars): ...`
- `ObsidianCliError` → `[CLI] ...\nExit code: 1\nStderr: ...`
- `ObsidianApiError` → existente (status code REST)
- `TypeError` (fetch) → existente (offline)

## Testes

### `tests/obsidian-cli.test.ts`

Estrutura (cada `it` é um teste isolado):

```ts
import { test, expect, mock } from "bun:test";
import { ObsidianCliClient, ObsidianCliError, ObsidianCliSchemaError, ObsidianCliTimeoutError } from "../src/shared/obsidian-cli.js";
import { z } from "zod";

// Mock helper que cria um spawn fake retornando exitCode + stdout + stderr ou timeout
function mockSpawn({ stdout = "", stderr = "", exitCode = 0, hangForever = false }) { ... }

test("isAvailable cacheia true após primeiro sucesso", async () => { ... });
test("isAvailable cacheia false após primeiro erro", async () => { ... });
test("isAvailable retorna mesmo valor em chamadas subsequentes sem novo spawn", async () => { ... });
test("run<T> retorna dado parseado quando JSON válido + schema OK", async () => { ... });
test("run<T> lança ObsidianCliError quando exit code != 0", async () => { ... });
test("run<T> lança ObsidianCliTimeoutError quando timeout", async () => { ... });
test("run<T> lança ObsidianCliSchemaError quando JSON inválido", async () => { ... });
test("run<T> lança ObsidianCliSchemaError quando schema Zod falha", async () => { ... });
test("runVoid retorna undefined em exit 0", async () => { ... });
test("runVoid lança ObsidianCliError em exit != 0", async () => { ... });
test("run injeta format=json se ausente", async () => { ... });
test("run não duplica format=json se presente", async () => { ... });
test("mensagem de erro contém comando truncado", async () => { ... });
test("args com caracteres especiais preservados (sem shell)", async () => { ... });
```

Total: ~14 testes.

### `tests/cli-schemas.test.ts`

```ts
import { test, expect } from "bun:test";
import { BacklinksResult, OutlineResult, UnresolvedLinksResult, OrphansResult } from "../src/modules/graph/graph.types.js";
import { PropertyReadResult } from "../src/modules/properties/properties.types.js";
import { Task, TasksListResult, TaskToggleResult } from "../src/modules/tasks/tasks.types.js";
import { SearchContextResult } from "../src/modules/search/search.types.js";

test("BacklinksResult aceita payload válido", () => { ... });
test("BacklinksResult rejeita level > 6 em HeadingEntry", () => { ... });
test("OutlineResult aceita payload válido", () => { ... });
test("OutlineResult rejeita level fora 1..6", () => { ... });
test("UnresolvedLinksResult aceita payload mínimo", () => { ... });
test("OrphansResult aceita lista vazia", () => { ... });
test("PropertyReadResult aceita value null", () => { ... });
test("PropertyReadResult aceita value array de string", () => { ... });
test("Task rejeita status inválido", () => { ... });
test("TasksListResult aceita lista vazia", () => { ... });
test("TaskToggleResult valida transição válida", () => { ... });
test("SearchContextResult aceita match com before/after vazios", () => { ... });
```

Total: ~12 testes.

### Estratégia de mock do `spawn`

Bun's `mock.module()` permite mockar `node:child_process`:

```ts
const spawnMock = mock(() => createFakeChild({ stdout: "...", exitCode: 0 }));
mock.module("node:child_process", () => ({ spawn: spawnMock }));
```

`createFakeChild` retorna um objeto que implementa `ChildProcess` (com `stdout`/`stderr` como `EventEmitter` que emitem `data` e depois `end`, e o próprio child emite `exit`/`close`). Para timeout: nunca emite exit, espera `AbortController` chamar `kill`.

Helper privado de teste em `tests/helpers/fake-child.ts`.

### Smoke manual (para tools individuais — fora de `bun test`)

Documentado no `context.md` da spec como roteiro a executar pelo dev após build. Cobre AC2 ponto a ponto.

## Mudanças exatas em arquivos existentes

| Arquivo | Mudança | Bytes alterados |
|---|---|---|
| `src/index.ts` | 5 imports novos + criação `cliClient` + `await isAvailable()` + 4 chamadas `register*Tools` novas + 1 parâmetro extra em `registerSearchTools` | ~15 linhas adicionadas, 1 modificada |
| `src/shared/config.ts` | Resolve `cliPath` em ambos os ramos (saved/env) | ~5 linhas adicionadas, 0 removidas |
| `src/shared/setup.ts` | `SavedConfig` ganha `cliPath?`; `runSetup` ganha 5º prompt; `saveConfig` passa `cliPath` | ~6 linhas adicionadas, 1 modificada |
| `src/shared/errors.ts` | 3 funções privadas novas, 3 ramos `instanceof` novos em `formatObsidianError`, alias `safeCli`, constante `CLI_UNAVAILABLE_MESSAGE`, helper `cliUnavailableResult` | ~30 linhas adicionadas, 0 removidas |
| `src/modules/search/search.tools.ts` | Import novo, schema novo, handler novo, parâmetro extra, chamada `server.tool` nova | ~25 linhas adicionadas, 1 modificada (assinatura) |
| `src/modules/search/search.types.ts` | 2 schemas Zod novos | ~12 linhas adicionadas |
| `README.md` | Seção "Requirements" mencionando 1.12.7 + tabela de 12 tools novas | ~30 linhas adicionadas |
| `package.json` | `version` `1.1.2` → `1.2.0`, script `"test": "bun test"` | 2 modificações |

Total existente tocado: 8 arquivos, ~125 linhas adicionadas, 5 linhas modificadas, **0 linhas removidas em código de produção**.

## Arquivos novos

| Path | Conteúdo |
|---|---|
| `src/shared/obsidian-cli.ts` | `ObsidianCliClient` + 3 classes erro + helpers privados |
| `src/modules/file-ops/index.ts` | re-export |
| `src/modules/file-ops/file-ops.tools.ts` | 2 handlers + 2 schemas + `registerFileOpsTools` |
| `src/modules/graph/index.ts` | re-export |
| `src/modules/graph/graph.tools.ts` | 4 handlers + 4 schemas input + `registerGraphTools` |
| `src/modules/graph/graph.types.ts` | Schemas Zod de retorno |
| `src/modules/properties/index.ts` | re-export |
| `src/modules/properties/properties.tools.ts` | 3 handlers + 3 schemas input + `buildPropertySetArgs` + `registerPropertiesTools` |
| `src/modules/properties/properties.types.ts` | Schemas Zod de retorno |
| `src/modules/tasks/index.ts` | re-export |
| `src/modules/tasks/tasks.tools.ts` | 2 handlers + 2 schemas input + `registerTasksTools` |
| `src/modules/tasks/tasks.types.ts` | Schemas Zod de retorno |
| `tests/obsidian-cli.test.ts` | ~14 testes |
| `tests/cli-schemas.test.ts` | ~12 testes |
| `tests/helpers/fake-child.ts` | Helper para mockar `spawn` |

Total: 15 arquivos novos.

## Riscos e mitigações

### R-1 — Schema do CLI 1.12.7 não documentado publicamente

**Risco:** Schemas Zod definidos a priori podem não casar com payload real do CLI, fazendo todas as 5 tools de leitura (graph + propertyGet + tasksList + searchContext) falharem com `ObsidianCliSchemaError`.

**Mitigação:**
- Implementação acontece com Obsidian rodando localmente; primeiro contato com cada comando ajusta o schema antes de fechar a tarefa.
- Mensagem de erro do `ObsidianCliSchemaError` inclui stdout sample → debug visual rápido.
- Schemas tolerantes onde possível: campos opcionais (`line`, `context`) em vez de strict.

### R-2 — Convenção de serialização de `propertySet` com array

**Risco:** CLI pode esperar CSV, JSON inline, ou args repetidos. Não há documentação clara.

**Mitigação:**
- Helper `buildPropertySetArgs` isolado. Se a primeira convenção (CSV) falha em teste manual, troca por outra em ~3 linhas.
- Task de implementação dedica explicitamente um passo "ajustar convenção se necessário".

### R-3 — CLI demora muito em vault grande (timeout default 30s)

**Risco:** `vaultOrphans` ou `vaultUnresolvedLinks` em vault de 10k+ notas pode estourar 30s.

**Mitigação:**
- `ObsidianCliTimeoutError` é amigável e indica que basta aumentar o timeout.
- Config futura pode parametrizar timeout por tool.

### R-4 — CLI muda schema entre versões do Obsidian

**Risco:** Update do Obsidian para 1.13 muda formato de saída e quebra todas as 5 tools de leitura.

**Mitigação:**
- Mensagens de erro Zod citam comando exato → fácil identificar qual mudou.
- Out of scope: schema-versioning. Quando acontecer, abre spec corretiva.

### R-5 — Binário `obsidian` no PATH conflita com outro programa

**Risco:** Usuário tem outro `obsidian` no PATH (algum CLI sem relação).

**Mitigação:**
- Probe `--version` provavelmente retorna stdout diferente do esperado. `isAvailable()` retorna `true` mesmo assim (só checa exit 0), mas a primeira tool de leitura vai falhar em `ObsidianCliSchemaError`.
- Solução: usuário configura `cliPath` absoluto via setup ou env.
- Out of scope: probar conteúdo do `--version` para validar identidade do binário. Adiciona complexidade marginal.

### R-6 — `spawn` em Bun se comporta diferente de Node

**Risco:** Algum edge case do `node:child_process` em runtime Bun (dev) diverge do Node (build).

**Mitigação:**
- Testes rodam em `bun test` (mesmo runtime que dev).
- Smoke manual final é com `node build/index.js` (runtime de produção).
- Se divergência aparecer, é detectada antes do release.

## Decisões registradas como `[default]` (já cobertas em Out of Scope/Decisões)

Ver seção "Decisões arquiteturais" do `spec.md` — D1 a D19.
