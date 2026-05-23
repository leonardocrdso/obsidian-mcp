# Tasks — Obsidian CLI Tools

Ordem incremental: 1 ou poucos commits por task. Cada task fecha com `bun run build` verde, `bun test` verde quando aplicável, e `std_review` limpo nos arquivos tocados/criados.

## Pré-requisitos

- [ ] `bun install` instalado e funcional na máquina do dev
- [ ] Obsidian app instalado, versão >= 1.12.7
- [ ] CLI `obsidian` disponível no PATH (verificar com `obsidian --version`) ou path absoluto conhecido para configurar via setup/env
- [ ] Acesso ao Obsidian rodando localmente com vault populado (para smoke manual de AC2 ao final)
- [ ] Plugin Local REST API permanece configurado (para smoke das 22 tools antigas em AC4)
- [ ] `std_review` MCP disponível na sessão
- [ ] MCPs `clean-code` e `modular-monolith` consultados durante codificação (regra global do projeto)

## Sequência canônica

```
T1 obsidian-cli (client + erros)
  └─ T2 testes do obsidian-cli
       └─ T3 errors.ts (3 ramos + safeCli + cliUnavailable)
            └─ T4 config + setup (cliPath)
                 ├─ T5 file-ops (move/rename)
                 ├─ T6 graph (4 leituras)
                 ├─ T7 properties (3)
                 ├─ T8 tasks (2)
                 └─ T9 searchContext no search/
                      └─ T10 testes dos schemas
                           └─ T11 wiring em index.ts
                                └─ T12 README + bump 1.2.0
                                     └─ T13 review final + smoke completo
```

T5–T9 são marcadas [P] (paralelas entre si) — cada uma só depende de T4 e do `ObsidianCliClient` pronto. Em fluxo solo, executar em sequência.

---

## T1 — Criar `src/shared/obsidian-cli.ts` com client + erros

Cobre R1, R2.

- [ ] `Read` em `src/shared/obsidian-client.ts` e `src/shared/errors.ts` para alinhar estilo
- [ ] Consultar MCP `clean-code` antes de codar (limites function-length, nesting-depth)
- [ ] Criar `src/shared/obsidian-cli.ts`
- [ ] Implementar 3 classes de erro:
  - [ ] `ObsidianCliError { command, exitCode, stderr }`
  - [ ] `ObsidianCliSchemaError { command, issues, stdoutSample }`
  - [ ] `ObsidianCliTimeoutError { command, timeoutMs }`
- [ ] Implementar helpers privados do arquivo:
  - [ ] `truncateCommand(cliPath, args, max=200): string`
  - [ ] `ensureFormatJson(args: string[]): string[]`
  - [ ] `spawnWithTimeout(cliPath, args, timeoutMs): Promise<{ stdout, stderr, exitCode }>` (lança `ObsidianCliTimeoutError` em timeout)
  - [ ] `formatZodIssues(issues, max=3): string`
  - [ ] `truncateStdout(stdout, max=200): string`
- [ ] Implementar `ObsidianCliClient`:
  - [ ] `constructor(cliPath, defaults?: { timeoutMs?: number })` (default 30000)
  - [ ] `private cache: boolean | null = null`
  - [ ] `isAvailable(): Promise<boolean>` (probe `--version` timeout 5s; cacheia; nunca lança)
  - [ ] `get available(): boolean` (lança se cache === null)
  - [ ] `run<T>(args, schema): Promise<T>` (fluxo da seção "Fluxo de run" do design)
  - [ ] `runVoid(args): Promise<void>`
- [ ] Garantir `spawn(..., { shell: false, stdio: ["ignore", "pipe", "pipe"] })`
- [ ] Garantir `AbortController` para timeout
- [ ] `bun run build` → exit 0
- [ ] `std_review filePath=src/shared/obsidian-cli.ts` → 0 warnings de function-length/nesting-depth
- [ ] Commit: `feat(cli): adicionar ObsidianCliClient com spawn tipado`

## T2 — Testes do `ObsidianCliClient` em `tests/obsidian-cli.test.ts`

Cobre R13 (parte cliente). Cobre AC5, AC6, AC7, AC8, AC15.

- [ ] Criar `tests/helpers/fake-child.ts`:
  - [ ] Função `createFakeChild({ stdout, stderr, exitCode, hangForever })` retornando objeto compatível com `ChildProcess`
  - [ ] `stdout` e `stderr` como EventEmitter emitindo `data` (Buffer) e `end`
  - [ ] Child emitindo `exit` (ou `close`) com exitCode
  - [ ] Se `hangForever`: nunca emite exit; responde a `SIGTERM` quando `AbortController` chama `kill`
- [ ] Criar `tests/obsidian-cli.test.ts`:
  - [ ] `mock.module("node:child_process", ...)` para injetar `spawn` fake
  - [ ] `test("isAvailable cacheia true após primeiro sucesso")` (AC8)
  - [ ] `test("isAvailable cacheia false após primeiro erro")`
  - [ ] `test("isAvailable não relança em qualquer falha")`
  - [ ] `test("isAvailable não chama spawn na 2ª invocação")` (AC8)
  - [ ] `test("get available lança quando cache null")`
  - [ ] `test("run<T> retorna dado quando JSON+schema OK")`
  - [ ] `test("run<T> lança ObsidianCliError em exit != 0")` (AC5)
  - [ ] `test("ObsidianCliError contém command e exitCode")`
  - [ ] `test("run<T> lança ObsidianCliSchemaError quando JSON inválido")` (AC6)
  - [ ] `test("run<T> lança ObsidianCliSchemaError quando schema falha")` (AC6)
  - [ ] `test("ObsidianCliSchemaError cita comando e 3 primeiros issues")`
  - [ ] `test("run<T> lança ObsidianCliTimeoutError em timeout")` (AC7)
  - [ ] `test("runVoid retorna undefined em exit 0")`
  - [ ] `test("runVoid lança ObsidianCliError em exit != 0")`
  - [ ] `test("ensureFormatJson injeta format=json se ausente")`
  - [ ] `test("ensureFormatJson não duplica format=json")`
  - [ ] `test("args com espaços e $ preservados sem shell")` (AC15)
  - [ ] `test("mensagem de erro cita subcommand")` (AC20)
- [ ] Adicionar script `"test": "bun test"` ao `package.json`
- [ ] `bun test` → todos verdes
- [ ] `std_review` em `tests/obsidian-cli.test.ts` e `tests/helpers/fake-child.ts`
- [ ] Commit: `test(cli): adicionar testes unitários do ObsidianCliClient`

## T3 — Estender `src/shared/errors.ts` com tratamento CLI

Cobre R3.

- [ ] `Read src/shared/errors.ts`
- [ ] `std_check_impact filePath=src/shared/errors.ts`
- [ ] Adicionar imports: `ObsidianCliError, ObsidianCliSchemaError, ObsidianCliTimeoutError` de `./obsidian-cli.js`
- [ ] Adicionar constante `CLI_UNAVAILABLE_MESSAGE`
- [ ] Adicionar helper `cliUnavailableResult(): ToolResult`
- [ ] Adicionar 3 funções privadas:
  - [ ] `resolveCliErrorMessage(error: ObsidianCliError): string`
  - [ ] `resolveCliSchemaMessage(error: ObsidianCliSchemaError): string`
  - [ ] `resolveCliTimeoutMessage(error: ObsidianCliTimeoutError): string`
- [ ] Em `formatObsidianError`, adicionar 3 ramos `instanceof` no topo (antes dos ramos existentes)
- [ ] Adicionar `export const safeCli = safeTool;`
- [ ] Validar: 0 linhas existentes removidas/modificadas; só adições
- [ ] `bun run build` → exit 0
- [ ] `std_review filePath=src/shared/errors.ts` → sem warning novo
- [ ] Commit: `feat(errors): adicionar resolvers de erro CLI e safeCli`

## T4 — Estender config e setup com `cliPath`

Cobre R4.

- [ ] `Read src/shared/config.ts src/shared/setup.ts`
- [ ] `std_check_impact` em ambos
- [ ] `src/shared/setup.ts`:
  - [ ] `SavedConfig` ganha campo opcional `cliPath?: string`
  - [ ] `runSetup` adiciona 5º prompt: `const cliPath = await ask("Caminho do CLI", existing?.cliPath ?? "obsidian");`
  - [ ] Passa `cliPath` ao `saveConfig`
- [ ] `src/shared/config.ts`:
  - [ ] Resolve `cliPath` no ramo "saved" e no ramo "env"
  - [ ] Ordem: saved.cliPath → process.env.OBSIDIAN_CLI_PATH → `"obsidian"`
  - [ ] Inclui `cliPath` no objeto de retorno (ambos os ramos)
- [ ] `bun run build` → exit 0
- [ ] Smoke: `node build/index.js --setup` mostra 5 prompts (AC14)
- [ ] Smoke: arquivo `~/.obsidian-mcp.json` contém `cliPath`
- [ ] `std_review` em ambos os arquivos
- [ ] Commit: `feat(config): adicionar cliPath ao setup e config`

## T5 [P] — Módulo `src/modules/file-ops/`

Cobre R5. Tools: `vaultMoveFile`, `vaultRenameFile`.

- [ ] Consultar MCP `clean-code` e `modular-monolith` antes de codar
- [ ] Criar `src/modules/file-ops/index.ts` (re-export)
- [ ] Criar `src/modules/file-ops/file-ops.tools.ts`:
  - [ ] Imports: `McpServer`, `z`, `ObsidianCliClient`, `safeCli`, `cliUnavailableResult`
  - [ ] Const `vaultMoveFileSchema = { from: z.string(), to: z.string() }`
  - [ ] Const `vaultRenameFileSchema = { path: z.string(), newName: z.string() }`
  - [ ] `handleVaultMoveFile(cli, { from, to })`:
    - guard `if (!cli.available) return cliUnavailableResult()`
    - `await cli.runVoid(["move", "file=" + from, "to=" + to])`
    - return `{ content: [{ type: "text", text: "Arquivo movido: ... → ..." }] }`
  - [ ] `handleVaultRenameFile(cli, { path, newName })` análogo
  - [ ] `registerFileOpsTools(server, cli)`:
    - `server.tool("vaultMoveFile", "...", schema, safeCli((p) => handleVaultMoveFile(cli, p)))`
    - `server.tool("vaultRenameFile", "...", schema, safeCli((p) => handleVaultRenameFile(cli, p)))`
- [ ] `bun run build` → exit 0
- [ ] `std_review` nos 2 arquivos novos → 0 warnings
- [ ] Commit: `feat(file-ops): adicionar tools vaultMoveFile e vaultRenameFile via CLI`

## T6 [P] — Módulo `src/modules/graph/`

Cobre R6. Tools: `vaultBacklinks`, `vaultOutline`, `vaultUnresolvedLinks`, `vaultOrphans`.

- [x] Consultar MCP `clean-code`
- [x] Criar `src/modules/graph/index.ts` (re-export)
- [x] Criar `src/modules/graph/graph.types.ts`:
  - [x] `BacklinkEntry`, `BacklinksResult`
  - [x] `HeadingEntry`, `OutlineResult`
  - [x] `UnresolvedLink`, `UnresolvedLinksResult`
  - [x] `OrphansResult`
- [x] Criar `src/modules/graph/graph.tools.ts`:
  - [x] Input schemas inline (`vaultBacklinksSchema`, etc.)
  - [x] Helper local `jsonResult(data)` que retorna `{ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] }`
  - [x] 4 handlers seguindo padrão (guard available + run + jsonResult)
  - [x] `registerGraphTools(server, cli)` orquestrador linear
- [x] **Antes de fechar:** rodar manualmente cada uma contra Obsidian real, ajustar schemas Zod em `graph.types.ts` se payload divergir
- [x] `bun run build` → exit 0
- [x] `std_review` nos 3 arquivos novos → 0 warnings
- [x] Anotar no `context.md` da spec qualquer ajuste de schema necessário
- [x] Commit: `feat(graph): adicionar tools backlinks/outline/unresolved/orphans via CLI`

## T7 [P] — Módulo `src/modules/properties/`

Cobre R7. Tools: `propertyGet`, `propertySet`, `propertyRemove`.

- [ ] Consultar MCP `clean-code`
- [ ] Criar `src/modules/properties/index.ts`
- [ ] Criar `src/modules/properties/properties.types.ts`:
  - [ ] `PropertyValue`, `PropertyType`, `PropertyReadResult`
- [ ] Criar `src/modules/properties/properties.tools.ts`:
  - [ ] Input schemas: `propertyGetSchema`, `propertySetSchema`, `propertyRemoveSchema`
  - [ ] Helper privado `buildPropertySetArgs(params): string[]` (isola serialização de array; default CSV)
  - [ ] 3 handlers
  - [ ] `registerPropertiesTools`
- [ ] **Antes de fechar:** rodar manualmente `propertySet` com value array contra Obsidian real; se CSV não funcionar, ajustar `buildPropertySetArgs` para outra convenção (args repetidos ou JSON inline). Anotar decisão em `context.md`.
- [ ] `bun run build` → exit 0
- [ ] `std_review` → 0 warnings
- [ ] Commit: `feat(properties): adicionar tools propertyGet/Set/Remove via CLI`

## T8 [P] — Módulo `src/modules/tasks/`

Cobre R8. Tools: `tasksList`, `taskToggle`.

- [ ] Consultar MCP `clean-code`
- [ ] Criar `src/modules/tasks/index.ts`
- [ ] Criar `src/modules/tasks/tasks.types.ts`:
  - [ ] `TaskStatus`, `Task`, `TasksListResult`, `TaskToggleResult`
- [ ] Criar `src/modules/tasks/tasks.tools.ts`:
  - [ ] Input schemas `tasksListSchema`, `taskToggleSchema`
  - [ ] 2 handlers (construção de argv condicional para `path` e `status` em `tasksList`)
  - [ ] `registerTasksTools`
- [ ] Validar contra Obsidian real (ajustar schemas se divergir)
- [ ] `bun run build` → exit 0
- [ ] `std_review` → 0 warnings
- [ ] Commit: `feat(tasks): adicionar tools tasksList e taskToggle via CLI`

## T9 [P] — Estender `src/modules/search/` com `searchContext`

Cobre R9. Tool nova: `searchContext`.

- [ ] `Read src/modules/search/search.tools.ts src/modules/search/search.types.ts`
- [ ] `std_check_impact` em `search.tools.ts`
- [ ] Em `search.types.ts`, **adicionar** (não remover/modificar):
  - [ ] `SearchContextMatch` (z.object)
  - [ ] `SearchContextResult` (z.object)
- [ ] Em `search.tools.ts`, **adicionar** (handlers existentes intocados byte-a-byte):
  - [ ] Import `ObsidianCliClient`, `safeCli`, `cliUnavailableResult`, `SearchContextResult`
  - [ ] Const `searchContextSchema = { query: z.string(), contextLines: z.number().int().min(0).max(20).optional() }`
  - [ ] Handler `handleSearchContext(cli, { query, contextLines })`
  - [ ] **Modificar apenas a assinatura** de `registerSearchTools` para receber `cliClient: ObsidianCliClient` como 3º parâmetro
  - [ ] Acrescentar `server.tool("searchContext", ...)` no final do corpo de `registerSearchTools`
- [ ] Validar com `git diff`: 0 linhas removidas em `search.tools.ts`, 1 linha modificada (assinatura de função), resto adições (AC18)
- [ ] `bun run build` → exit 0
- [ ] Validar contra Obsidian real
- [ ] `std_review filePath=src/modules/search/search.tools.ts` → sem warning novo
- [ ] Commit: `feat(search): adicionar tool searchContext via CLI`

## T10 — Testes dos schemas Zod em `tests/cli-schemas.test.ts`

Cobre R13 (parte schemas). Depende de T6, T7, T8, T9.

- [ ] Criar `tests/cli-schemas.test.ts`
- [ ] Importar schemas de `graph.types`, `properties.types`, `tasks.types`, `search.types`
- [ ] `test("BacklinksResult aceita payload válido")` com payload JSON literal
- [ ] `test("BacklinksResult rejeita estrutura malformada")` (ex.: backlinks sem path)
- [ ] `test("OutlineResult aceita payload válido")`
- [ ] `test("OutlineResult rejeita level fora 1..6")`
- [ ] `test("UnresolvedLinksResult aceita lista vazia")`
- [ ] `test("OrphansResult aceita lista vazia")`
- [ ] `test("PropertyReadResult aceita value null")`
- [ ] `test("PropertyReadResult aceita value array de string")`
- [ ] `test("PropertyReadResult rejeita type inválido")`
- [ ] `test("Task rejeita status inválido")`
- [ ] `test("TasksListResult aceita lista vazia")`
- [ ] `test("TaskToggleResult valida transição válida")`
- [ ] `test("SearchContextResult aceita match com before/after vazios")`
- [ ] `bun test` → todos verdes (incluindo testes de T2)
- [ ] `std_review tests/cli-schemas.test.ts` → 0 warnings
- [ ] Commit: `test(cli): adicionar testes dos schemas Zod`

## T11 — Wiring em `src/index.ts`

Cobre R10. Depende de T1, T3, T4, T5, T6, T7, T8, T9.

- [ ] `Read src/index.ts`
- [ ] `std_check_impact filePath=src/index.ts`
- [ ] Adicionar imports:
  - [ ] `ObsidianCliClient` de `./shared/obsidian-cli.js`
  - [ ] 4 `register*Tools` (file-ops, graph, properties, tasks)
- [ ] Criar `cliClient = new ObsidianCliClient(config.cliPath)`
- [ ] `await cliClient.isAvailable()` antes dos `register*Tools`
- [ ] Modificar `registerSearchTools(server, client)` → `registerSearchTools(server, client, cliClient)` (1 linha modificada)
- [ ] Acrescentar 4 chamadas `register*Tools` novas
- [ ] Validar: 0 linhas removidas em `index.ts`
- [ ] `bun run build` → exit 0
- [ ] Smoke: `node build/index.js` sobe sem erro (mesmo se CLI ausente — AC4, AC19)
- [ ] Smoke: cliente MCP lista 34 tools (AC1)
- [ ] `std_review` → sem warning novo
- [ ] Commit: `feat(server): wire CLI client e registrar 4 módulos novos + searchContext`

## T12 — README + bump de versão

Cobre R14, R17.

- [ ] `Read README.md`
- [ ] Adicionar seção "Requirements" mencionando Obsidian >= 1.12.7 para tools CLI-based
- [ ] Adicionar tabela com as 12 tools novas (nome + descrição curta)
- [ ] Nota: "tools CLI-based ficam dormentes se CLI ausente; REST continua funcional"
- [ ] `package.json`: `"version": "1.1.2"` → `"version": "1.2.0"`
- [ ] Validar AC16: `grep -E "1\.12\.7|vaultMoveFile|vaultBacklinks|propertyGet|tasksList|searchContext" README.md` → múltiplos hits
- [ ] Commit: `docs(readme): documentar 12 tools CLI e bump 1.2.0`

## T13 — Review final + smoke completo

Cobre AC1, AC2, AC3, AC4, AC9, AC10, AC11, AC12, AC13, AC14, AC18, AC19, AC20.

- [ ] `bun run build` → exit 0 (AC9)
- [ ] `bun test` → todos verdes (AC10)
- [ ] `std_review` em todos os arquivos novos:
  - [ ] `src/shared/obsidian-cli.ts`
  - [ ] `src/modules/file-ops/file-ops.tools.ts`
  - [ ] `src/modules/graph/graph.tools.ts`
  - [ ] `src/modules/graph/graph.types.ts`
  - [ ] `src/modules/properties/properties.tools.ts`
  - [ ] `src/modules/properties/properties.types.ts`
  - [ ] `src/modules/tasks/tasks.tools.ts`
  - [ ] `src/modules/tasks/tasks.types.ts`
  - [ ] `tests/obsidian-cli.test.ts`
  - [ ] `tests/cli-schemas.test.ts`
  - [ ] (AC11) → 0 warnings em todos
- [ ] `std_review` em arquivos tocados:
  - [ ] `src/index.ts`
  - [ ] `src/shared/config.ts`
  - [ ] `src/shared/setup.ts`
  - [ ] `src/shared/errors.ts`
  - [ ] `src/modules/search/search.tools.ts`
  - [ ] `src/modules/search/search.types.ts`
  - [ ] (AC12) → sem warning novo comparado ao pré-feature
- [ ] AC13: `git diff main..HEAD -- src/ tests/ | grep -E "^\+\s*(//|/\*)" | wc -l` → `0`
- [ ] AC18: `git diff main..HEAD -- src/modules/search/search.tools.ts | grep -E "^-" | grep -v "^---" | wc -l` → `0`
- [ ] Smoke manual com CLI disponível (AC2):
  - [ ] `vaultMoveFile from="testes/A.md" to="testes/sub/A.md"` → arquivo movido, wikilinks de notas linkando A.md ajustados (verificar com `vaultBacklinks` antes/depois)
  - [ ] `vaultRenameFile path="testes/sub/A.md" newName="B.md"` → renomeado
  - [ ] `vaultBacklinks path="testes/sub/B.md"` → JSON
  - [ ] `vaultOutline path="testes/sub/B.md"` → JSON com headings
  - [ ] `vaultUnresolvedLinks` → JSON
  - [ ] `vaultOrphans` → JSON
  - [ ] `propertyGet path="testes/sub/B.md" key="status"` → JSON
  - [ ] `propertySet path="testes/sub/B.md" key="status" value="done" type="text"` → confirmação
  - [ ] `propertySet path="testes/sub/B.md" key="tags" value=["a","b","c"] type="list"` → confirmação (ajustar `buildPropertySetArgs` se necessário; anotar em context.md)
  - [ ] `propertyRemove path="testes/sub/B.md" key="status"` → confirmação
  - [ ] `tasksList path="testes/sub/B.md"` → JSON
  - [ ] `taskToggle ref=<ref>` → confirmação
  - [ ] `searchContext query="TODO" contextLines=2` → JSON
- [ ] Smoke com CLI ausente (AC3): `OBSIDIAN_CLI_PATH=/bin/nonexistent node build/index.js` →
  - [ ] Servidor sobe (AC4)
  - [ ] `vaultBacklinks path="X.md"` retorna mensagem "Obsidian CLI não disponível"
  - [ ] `vaultListFiles` (REST) continua funcionando (AC4)
- [ ] Smoke AC19: `OBSIDIAN_CLI_PATH=/bin/sleep node build/index.js` → servidor sobe em ≤6s
- [ ] Smoke AC14: `node build/index.js --setup` mostra 5 prompts
- [ ] Tag/branch ou PR pronto para merge
- [ ] Commit final (se houver ajustes de polish): `chore(spec-002): review final e smoke completo`
- [ ] Marcar spec como `done` via `mcp__lad-mcp__spec_status slug=002-obsidian-cli-tools status=done`

---

## Verificação de cobertura de requisitos

| Requisito | Tasks |
|---|---|
| R1 | T1 |
| R2 | T1 |
| R3 | T3 |
| R4 | T4 |
| R5 | T5 |
| R6 | T6 |
| R7 | T7 |
| R8 | T8 |
| R9 | T9 |
| R10 | T11 |
| R11 | T1 (probe), T5–T9 (guards), T11 (boot call) |
| R12 | T1, T2 (testes) |
| R13 | T2, T10 |
| R14 | T12 |
| R15 | T9 (preserva search), T11 (preserva index demais) — verificado em T13 (AC18) |
| R16 | T13 (AC13) |
| R17 | T12 |

| AC | Tasks |
|---|---|
| AC1 | T11, T13 |
| AC2 | T13 (smoke) |
| AC3 | T13 (smoke) |
| AC4 | T13 (smoke) |
| AC5 | T2 |
| AC6 | T2 |
| AC7 | T2 |
| AC8 | T2 |
| AC9 | T13 |
| AC10 | T13 |
| AC11 | T13 |
| AC12 | T13 |
| AC13 | T13 |
| AC14 | T4 (smoke parcial), T13 (final) |
| AC15 | T2 |
| AC16 | T12 |
| AC17 | T12 |
| AC18 | T9, T13 |
| AC19 | T13 |
| AC20 | T2, T13 |
