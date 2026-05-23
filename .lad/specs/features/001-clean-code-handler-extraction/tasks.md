# Tasks — Clean Code Handler Extraction

Ordem incremental: 1 commit por task. Cada task fecha com `bun run build` verde e smoke da tool tocada.

## Pré-requisitos

- [ ] `bun install` instalado e funcional na máquina do dev
- [ ] Acesso ao Obsidian rodando localmente com plugin Local REST API ativo (para smoke manual)
- [ ] `std_review` MCP disponível na sessão

## Sequência canônica

```
T1 commands → T2 active-file → T3 search → T4 periodic → T5 vault
→ T6 errors → T7 obsidian-client → T8 setup
→ T9 review final + smoke completo
```

---

## T1 — Refatorar `src/modules/commands/commands.tools.ts`

**Tamanho atual:** 40 linhas | 2 tools | nesting 6

- [ ] Ler arquivo atual via `Read`
- [ ] `std_check_impact filePath=src/modules/commands/commands.tools.ts`
- [ ] Extrair `handleCommandsList(client)` como função top-level
- [ ] Extrair `handleCommandsExecute(client, params)` como função top-level
- [ ] Declarar `commandsExecuteSchema` como const top-level
- [ ] Declarar `type CommandsExecuteParams`
- [ ] Reescrever `registerCommandsTools` como orquestrador (cada `server.tool` chama o handler via `safeTool(arrow)`)
- [ ] Validar: descrição e nome das tools byte-a-byte iguais ao original
- [ ] `bun run build` → exit 0
- [ ] `std_review filePath=src/modules/commands/commands.tools.ts` → 0 warnings de function-length/nesting-depth
- [ ] Smoke: `node build/index.js` + cliente MCP → `commandsList` retorna mesma forma de saída
- [ ] Commit: `refactor(commands): extrair handlers em funções nomeadas`

---

## T2 — Refatorar `src/modules/active-file/active-file.tools.ts`

**Tamanho atual:** 105 linhas | 5 tools | nesting 6

- [ ] Ler arquivo atual via `Read`
- [ ] `std_check_impact filePath=src/modules/active-file/active-file.tools.ts`
- [ ] Declarar `patchFields` (const local) com as descrições atuais usadas em `activeFilePatch`
- [ ] Declarar `buildPatchHeaders(params)` privado do arquivo
- [ ] Declarar schemas top-level: `activeFileUpdateSchema`, `activeFileAppendSchema`, `activeFilePatchSchema` (último usa spread de `patchFields`)
- [ ] Declarar types inferidos (`z.infer` ou manual)
- [ ] Extrair handlers:
  - [ ] `handleActiveFileGet(client)`
  - [ ] `handleActiveFileUpdate(client, params)`
  - [ ] `handleActiveFileAppend(client, params)`
  - [ ] `handleActiveFilePatch(client, params)` — usa `buildPatchHeaders`
  - [ ] `handleActiveFileDelete(client)`
- [ ] Reescrever `registerActiveFileTools` como orquestrador linear
- [ ] Validar diff de schema PATCH: shape e descrições byte-a-byte iguais
- [ ] `bun run build` → exit 0
- [ ] `std_review filePath=src/modules/active-file/active-file.tools.ts` → 0 warnings críticos
- [ ] Smoke: `activeFileGet` (com Obsidian aberto em algum arquivo)
- [ ] Commit: `refactor(active-file): extrair handlers e consolidar headers PATCH`

---

## T3 — Refatorar `src/modules/search/search.tools.ts`

**Tamanho atual:** 71 linhas | 2 tools | nesting 6

- [ ] Ler arquivo atual via `Read`
- [ ] `std_check_impact filePath=src/modules/search/search.tools.ts`
- [ ] Declarar schemas top-level: `searchSimpleSchema`, `searchAdvancedSchema`
- [ ] Declarar types inferidos
- [ ] Extrair handlers:
  - [ ] `handleSearchSimple(client, params)` — inclui formatação dos `matches`
  - [ ] `handleSearchAdvanced(client, params)` — inclui escolha de `Content-Type` por `queryType`
- [ ] Opcional: extrair `formatSearchResults(results)` privado do arquivo se reduzir o handler para <15 linhas
- [ ] Reescrever `registerSearchTools` como orquestrador linear
- [ ] `bun run build` → exit 0
- [ ] `std_review` → 0 warnings críticos
- [ ] Smoke: `searchSimple query="teste"` retorna resultados ou "Nenhum resultado"
- [ ] Commit: `refactor(search): extrair handlers e isolar formatação`

---

## T4 — Refatorar `src/modules/periodic/periodic.tools.ts`

**Tamanho atual:** 115 linhas | 5 tools | nesting 6

- [ ] Ler arquivo atual via `Read`
- [ ] `std_check_impact filePath=src/modules/periodic/periodic.tools.ts`
- [ ] Manter `periodSchema` existente (já está top-level — não tocar)
- [ ] Declarar `patchFields` (const local) com as descrições atuais usadas em `periodicPatchContent`
- [ ] Declarar `buildPatchHeaders(params)` privado do arquivo
- [ ] Declarar schemas top-level por tool
- [ ] Declarar types inferidos
- [ ] Extrair handlers:
  - [ ] `handlePeriodicGetNote(client, params)`
  - [ ] `handlePeriodicCreateNote(client, params)`
  - [ ] `handlePeriodicAppendContent(client, params)`
  - [ ] `handlePeriodicPatchContent(client, params)` — usa `buildPatchHeaders`
  - [ ] `handlePeriodicDeleteNote(client, params)`
- [ ] Reescrever `registerPeriodicTools` como orquestrador linear
- [ ] Validar: descrição `"Identificador do alvo"` (sem o detalhe que aparece em vault) preservada
- [ ] `bun run build` → exit 0
- [ ] `std_review` → 0 warnings críticos
- [ ] Smoke: `periodicGetNote period=daily` retorna mesma forma de saída
- [ ] Commit: `refactor(periodic): extrair handlers e consolidar headers PATCH`

---

## T5 — Refatorar `src/modules/vault/vault.tools.ts`

**Tamanho atual:** 187 linhas | 8 tools | nesting 6

- [ ] Ler arquivo atual via `Read`
- [ ] `std_check_impact filePath=src/modules/vault/vault.tools.ts`
- [ ] Declarar `patchFields` (const local) — atenção: o campo `target` aqui tem descrição estendida `"Identificador do alvo (nome do heading, ID do block, ou chave do frontmatter)"`. PRESERVAR exatamente
- [ ] Declarar `buildPatchHeaders(params)` privado do arquivo
- [ ] Declarar schemas top-level para todas as 8 tools (algumas com schema vazio `{}` ou só `path`)
- [ ] Declarar types inferidos
- [ ] Extrair handlers:
  - [ ] `handleVaultListFiles(client, params)`
  - [ ] `handleVaultGetFile(client, params)`
  - [ ] `handleVaultGetMetadata(client, params)`
  - [ ] `handleVaultCreateFile(client, params)`
  - [ ] `handleVaultAppendContent(client, params)`
  - [ ] `handleVaultPatchContent(client, params)` — usa `buildPatchHeaders`
  - [ ] `handleVaultDeleteFile(client, params)`
  - [ ] `handleVaultOpenFile(client, params)`
- [ ] Reescrever `registerVaultTools` como orquestrador linear
- [ ] Validar diffs cuidadosos das descrições multilinhas (`vaultListFiles`, `vaultCreateFile`, `vaultAppendContent`) — usar `[...].join("\n")` idêntico
- [ ] `bun run build` → exit 0
- [ ] `std_review` → 0 warnings críticos
- [ ] Smoke: `vaultListFiles` (raiz) + `vaultGetFile path=<um arquivo qualquer>`
- [ ] Commit: `refactor(vault): extrair handlers e consolidar headers PATCH`

---

## T6 — Refatorar `src/shared/errors.ts`

**Tamanho atual:** 62 linhas, com `formatObsidianError` de 26 linhas

- [ ] Ler arquivo atual via `Read`
- [ ] `std_check_impact filePath=src/shared/errors.ts` (esperado: 6 dependentes — todos os módulos via `safeTool`)
- [ ] Declarar constantes top-level: `INVALID_TARGET_MESSAGE`, `NETWORK_OFFLINE_LINES`
- [ ] Extrair predicados: `isInvalidTargetError(error)`, `isNetworkError(error)`
- [ ] Extrair resolvers: `resolveApiErrorMessage(error)`, `resolveNetworkErrorMessage(error)`
- [ ] Reescrever `formatObsidianError` como dispatch de 4 linhas
- [ ] **Manter** `STATUS_MESSAGES`, `ObsidianApiError`, `safeTool`, `ToolResult`, `ToolHandler` exatamente como estão (exports inalterados)
- [ ] Validar saída byte-a-byte para 4 casos:
  - [ ] `ObsidianApiError(invalid-target, 400)` → mensagem sem `Detalhe:`
  - [ ] `ObsidianApiError("algo", 404)` → mensagem com `Detalhe: algo`
  - [ ] `TypeError("fetch failed: ...")` → 3 linhas
  - [ ] `new Error("xpto")` → `[ERRO] xpto`
- [ ] `bun run build` → exit 0
- [ ] `std_review filePath=src/shared/errors.ts` → 0 warnings críticos
- [ ] Smoke: provocar erro 404 (`vaultGetFile path="nao-existe.md"`) → mensagem amigável esperada
- [ ] Commit: `refactor(errors): extrair resolvers por tipo de erro`

---

## T7 — Refatorar `src/shared/obsidian-client.ts`

**Tamanho atual:** 60 linhas, `executeRequest` com nesting 6

- [ ] Ler arquivo atual via `Read`
- [ ] `std_check_impact filePath=src/shared/obsidian-client.ts` (esperado: 6 dependentes — todos os módulos + `index.ts`)
- [ ] Extrair `buildAuthHeaders(apiKey, extra?)` privado do arquivo
- [ ] Extrair `performFetch(url, options, baseUrl)` privado do arquivo — encapsula `try { fetch } catch { throw TypeError }`
- [ ] Extrair `readErrorBody(response)` privado do arquivo — encapsula `try { response.text() } catch { return statusText }`
- [ ] Reescrever `executeRequest` como sequência linear (sem try/catch aninhado)
- [ ] **Manter** API pública: `fetchJson`, `fetchText`, `fetchVoid`, `encodePath` com mesmas assinaturas
- [ ] **Manter** construtor `constructor(baseUrl, apiKey)` idêntico
- [ ] `bun run build` → exit 0
- [ ] `std_review filePath=src/shared/obsidian-client.ts` → 0 warnings críticos
- [ ] Smoke:
  - [ ] GET feliz: `vaultListFiles` retorna lista
  - [ ] POST feliz: `commandsExecute commandId="app:toggle-left-sidebar"`
  - [ ] Erro 404: `vaultGetFile path="nao-existe.md"` retorna mensagem amigável
  - [ ] Offline: derrubar Obsidian e chamar `vaultListFiles` → mensagem `[OFFLINE]`
- [ ] Commit: `refactor(obsidian-client): extrair fetch e leitura de body em helpers privados`

---

## T8 — Refatorar `src/shared/setup.ts`

**Tamanho atual:** 102 linhas, `createPrompt` 41 linhas, `runSetup` 24 linhas

- [ ] Ler arquivo atual via `Read`
- [ ] `std_check_impact filePath=src/shared/setup.ts` (esperado: 2 dependentes — `index.ts`, `config.ts`)
- [ ] Extrair `createLineBuffer(rl)` privado do arquivo — encapsula `lines[]` + `waiting` + handlers `line`/`close`
- [ ] Extrair `createAsk(buffer)` privado do arquivo — encapsula print + consumo + trim/fallback
- [ ] Reescrever `createPrompt` como composição de `createInterface` + `createLineBuffer` + `createAsk`
- [ ] **Manter** `runSetup`, `loadSavedConfig`, `SavedConfig`, `mask`, `saveConfig` inalterados
- [ ] `bun run build` → exit 0
- [ ] `std_review filePath=src/shared/setup.ts` → 0 warnings críticos para `createPrompt`
- [ ] Smoke: `node build/index.js --setup` apresenta os 4 prompts esperados e grava `~/.obsidian-mcp.json`. Atenção a não sobrescrever o config real do usuário — usar `HOME=/tmp/test-setup node build/index.js --setup` ou similar
- [ ] Commit: `refactor(setup): dividir createPrompt em buffer e ask`

---

## T9 — Review final consolidado e smoke completo

- [ ] `std_review` em todos os 8 arquivos refatorados → 0 warnings de function-length/nesting-depth
- [ ] `bun run build` → exit 0
- [ ] `git diff main..HEAD -- src/ | grep -E "^\+\s*(//|/\*)" | wc -l` → 0 (AC8)
- [ ] Smoke completo (AC10):
  - [ ] `vaultListFiles` (sem path)
  - [ ] `periodicGetNote period=daily`
  - [ ] `activeFileGet`
  - [ ] `searchSimple query="teste"`
  - [ ] `commandsList`
- [ ] Verificar contagem de tools registradas: 22 (8 vault + 5 periodic + 5 active-file + 2 search + 2 commands)
- [ ] Atualizar status da spec para `done` via `mcp__lad-mcp__spec_status`

---

## Critérios de pronto (definition of done por task)

Cada task só é considerada concluída quando:
1. Código alterado.
2. `bun run build` passa.
3. `std_review` no arquivo da task retorna 0 warnings das categorias listadas.
4. Smoke da task executado e saída comparada com referência mental do comportamento atual.
5. Commit criado seguindo convenção `refactor(<escopo>): ...` (sem Co-Authored-By, regra global).

## Notas operacionais

- **Worktree:** o usuário pode optar por trabalhar em branch separada (`refactor/clean-code-handlers`) ou direto em `main`. Não é exigência da spec.
- **PR:** se preferir 1 PR único com 8 commits, fica claro o histórico incremental. Se preferir 1 PR por commit, idem. Decisão do executor.
- **Versão npm:** não publicar versão nova ao concluir — refactor interno sem mudança observável (vide Out of Scope item 9).
