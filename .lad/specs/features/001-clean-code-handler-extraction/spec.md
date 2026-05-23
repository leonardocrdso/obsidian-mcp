# SPEC-001: Clean Code Handler Extraction

**Status:** done
**Created:** 2026-05-23T03:58:13.170Z
**Updated:** 2026-05-23T04:17:27.137Z

## Overview
## Contexto do produto

O `obsidian-mcp` é um pacote npm publicado (`@leonardocrdso/obsidian-mcp` v1.1.2) que expõe 22 tools MCP cobrindo a Local REST API do plugin Obsidian. O código está organizado em monolito modular (`src/modules/<dominio>/`) com um cliente HTTP compartilhado (`src/shared/obsidian-client.ts`).

Um `/lad-review` recente identificou 14 warnings de clean-code, todos do mesmo anti-pattern: cada módulo declara uma função `register<Nome>Tools(server, client)` cujo corpo é uma sequência de chamadas `server.tool(name, description, schema, async (params) => { ... })` com o handler embutido. O resultado é uma função-orquestrador inflada (até 179 linhas em `vault.tools.ts`) com nesting-depth 6 simultâneo a function-length excedido.

Além disso há dois pontos isolados em `shared/`:
- `errors.ts:formatObsidianError` (26 linhas) tem múltiplos branches `if/else` que podem ser decompostos em resolvers por tipo de erro.
- `obsidian-client.ts:executeRequest` (linha 16) tem dois try/catch aninhados (network + parse de body) que disparam nesting-depth 6.
- `setup.ts:createPrompt` (41 linhas) é uma factory readline que mistura buffer de linhas, fila de espera e closure `ask`.

Este SDD define um padrão de extração reutilizável e o roteiro incremental (1 módulo por commit) para eliminar os warnings sem mexer no contrato externo do pacote npm.

### Por que agora

O projeto vai ganhar novas tools e a regra global do CLAUDE.md exige aplicar clean-code de forma incremental ao tocar em código existente. Antes de adicionar features novas, vale normalizar o template de registro de tool — caso contrário cada novo handler vai herdar o anti-pattern e o débito cresce.

### Restrições herdadas do contexto

- Pacote npm publicado: contrato externo (tool names, descrições, schemas Zod) é imutável neste refactor.
- Regra global CLAUDE.md: sem comentários no código; refactor incremental, não big-bang.
- Sem testes automatizados no repo (verificado em `package.json`): aceite via `std_review` + build + smoke manual.
- Build via `bun run build` (não `tsc` direto, apesar do `tsconfig.json` configurado para `outDir build/`).

## Requirements
## Comportamento esperado

Após este refactor, cada arquivo `<modulo>.tools.ts` segue o mesmo template:

1. **Imports** (McpServer, zod, ObsidianClient, safeTool, types locais).
2. **Schemas Zod** declarados como constantes top-level quando reutilizados dentro do módulo (ex.: `periodSchema` já existe em `periodic.tools.ts`).
3. **Funções handler** uma por tool, nomeadas `handle<ToolName>` (camelCase, ex.: `handleVaultListFiles`, `handlePeriodicCreateNote`). Cada handler recebe `client: ObsidianClient` como primeiro parâmetro e `params: <inferido>` como segundo. Retorna `Promise<{ content: ... }>`.
4. **Função orquestradora** `register<Nome>Tools(server, client)` cujo corpo é uma sequência linear de `server.tool(name, description, schema, safeTool(async (params) => handler(client, params)))`. Sem lógica aninhada: cada `server.tool(...)` é uma única chamada de até ~10 linhas (nome + descrição + schema + adapter de uma linha).

O comportamento observável (resposta de cada tool MCP, contrato HTTP com o Obsidian, mensagens de erro) permanece idêntico.

Após o refactor:

- `formatObsidianError` em `src/shared/errors.ts` delega resolução por tipo de erro a funções privadas (`resolveApiErrorMessage`, `resolveNetworkErrorMessage`) e fica reduzido a um dispatch curto.
- `executeRequest` em `src/shared/obsidian-client.ts` extrai a network call e a leitura do body de erro em helpers privados do arquivo, eliminando o nesting de try/catch.
- `createPrompt` em `src/shared/setup.ts` é decomposto em (a) um buffer de linhas do readline e (b) uma fábrica `ask` que consome o buffer. Função pública `runSetup` mantém comportamento.

## Requisitos

### R1 — Padrão de handlers extraídos por módulo

Cada um dos cinco módulos (`commands`, `active-file`, `search`, `periodic`, `vault`) tem seus handlers inline extraídos em funções nomeadas top-level. A função `register*Tools` correspondente vira orquestrador linear.

**Decisão fixa:**
- Nome do handler: `handle<ToolName>` em camelCase, derivado do nome da tool MCP (ex.: tool `vaultListFiles` → `handleVaultListFiles`).
- Assinatura: `async function handle<Name>(client: ObsidianClient, params: <ParamsType>): Promise<ToolResult>`.
- Quando a tool não recebe parâmetros (ex.: `commandsList`, `activeFileGet`, `activeFileDelete`), assinatura é `async function handle<Name>(client: ObsidianClient): Promise<ToolResult>` (omite `params`).
- O wrap em `safeTool(...)` permanece dentro de `register*Tools` (não migra para o handler), porque `safeTool` é o adapter MCP e ficar na camada de registro deixa o handler testável isoladamente no futuro.

### R2 — Tipos de parâmetros explícitos

Para cada tool que recebe parâmetros, o módulo declara uma `type <ToolName>Params = z.infer<typeof <schemaConst>>` (ou inline na assinatura do handler). O schema Zod é definido como constante top-level no mesmo arquivo do módulo. Isso evita duplicar a forma do objeto entre o `server.tool` e a assinatura do handler.

### R3 — Reuso de schema PATCH dentro de cada módulo

Os campos PATCH (`operation`, `targetType`, `target`, `targetDelimiter`, `trimTargetWhitespace`, `createTargetIfMissing`) aparecem em `vaultPatchContent`, `periodicPatchContent` e `activeFilePatch` com exatamente os mesmos shapes. Para preservar 100% do contrato MCP, cada módulo continua declarando seu próprio schema (não há schema compartilhado em `shared/`). Em compensação, dentro de cada `<modulo>.tools.ts` extrai-se uma constante `patchFields` (objeto com os campos comuns) e o schema da tool específica usa spread (`{ ...patchFields, ...camposExtras }`). Isso reduz repetição local sem mover schemas para fora do módulo.

**Justificativa do escopo:** mover o schema para `shared/` introduziria acoplamento extra entre módulos por algo que é, conceitualmente, o "mesmo contrato HTTP do Obsidian". A duplicação local é aceitável; a duplicação intra-arquivo não é.

### R4 — `errors.ts`: dispatcher curto

`formatObsidianError(error: unknown): string` passa a ter no máximo 4 ramos diretos (ApiError / network TypeError / Error genérico / fallback `String(error)`) e delega cada ramo não-trivial a uma função privada do arquivo. Em particular, a lógica de `isInvalidTarget` migra para `resolveApiErrorMessage(error: ObsidianApiError): string`.

O lookup `STATUS_MESSAGES` continua sendo a fonte de mensagens por código HTTP (já é uma lookup table — não precisa virar outra estrutura).

### R5 — `obsidian-client.ts:executeRequest` sem nesting 6

`executeRequest` é decomposto em três funções privadas do arquivo:
- `buildHeaders(apiKey, extra?)` — monta headers com Bearer.
- `performFetch(url, options)` — chamada de `fetch` envolvida em try/catch para emitir o `TypeError` amigável quando offline.
- `readErrorBody(response)` — lê `response.text()` em try/catch silencioso e retorna `statusText` como fallback.

`executeRequest` consome os três em sequência linear, sem try/catch aninhado. **Restrição absoluta:** assinatura pública de `ObsidianClient` (`fetchJson`, `fetchText`, `fetchVoid`, `encodePath`) é imutável neste refactor.

### R6 — `setup.ts:createPrompt` dividido

`createPrompt` é dividido em:
- `createLineBuffer(rl)` — adapta o readline interface a um buffer com método `consume(): Promise<string>`.
- `createAsk(buffer, fallback?)` — função pura que formata o prompt e consome do buffer.
- `createPrompt` orquestra os dois e expõe `{ ask, close }` com a mesma assinatura atual.

`runSetup` permanece com a mesma orquestração (apenas os internals mudam).

### R7 — Contrato MCP preservado byte-a-byte

Para cada uma das 22 tools, a chamada `server.tool(name, description, schema, handler)` produz exatamente:
- Mesmo `name` (string literal idêntica).
- Mesma `description` (string literal idêntica, incluindo quebras de linha via `[...].join("\n")`).
- Mesmo `schema` Zod (mesmas chaves, mesmos tipos, mesmos `.describe()` e `.optional()`).

Verificação: `diff` entre o array de tools antes/depois (extraído via runtime ou inspeção visual) é vazio para nomes/descrições/schemas.

### R8 — Build verde após cada módulo

Após cada commit de refactor (1 por módulo), `bun run build` termina com exit code 0 e o `build/index.js` resultante carrega sem erro (`node build/index.js --setup` mostra o prompt de setup; `node build/index.js` sem config válida termina com a mensagem de erro esperada).

### R9 — Zero comentários adicionados

Por regra global do projeto (CLAUDE.md), nenhum comentário é introduzido. Funções extraídas devem ser autoexplicativas pelo nome e assinatura.

## Acceptance Criteria
## Critérios de aceitação testáveis

Cada AC abaixo deve ser verificável por comando ou observação direta após o refactor completo.

### AC1 — std_review sem warnings de function-length/nesting-depth nos arquivos refatorados

Quando `std_review` é executado nos seis arquivos (`src/modules/*/tools.ts` e `src/shared/{errors,obsidian-client,setup}.ts`), o sistema não deve reportar nenhum warning das categorias `function-length` ou `nesting-depth` para esses paths.

Comando de verificação:
```
std_review filePath=src/modules/vault/vault.tools.ts
std_review filePath=src/modules/periodic/periodic.tools.ts
std_review filePath=src/modules/active-file/active-file.tools.ts
std_review filePath=src/modules/search/search.tools.ts
std_review filePath=src/modules/commands/commands.tools.ts
std_review filePath=src/shared/errors.ts
std_review filePath=src/shared/obsidian-client.ts
std_review filePath=src/shared/setup.ts
```

### AC2 — Build passa após cada módulo refatorado

Após cada commit do refactor (commits intermediários por módulo), `bun run build` deve terminar com exit code 0 e gerar `build/index.js` sem erro de TypeScript.

### AC3 — Contrato MCP inalterado

O sistema deve registrar exatamente as mesmas 22 tools com nomes idênticos. Verificação: smoke manual rodando `node build/index.js` e listando tools via cliente MCP, comparando contra o estado pré-refactor.

Lista esperada (não muda):
- `vaultListFiles`, `vaultGetFile`, `vaultGetMetadata`, `vaultCreateFile`, `vaultAppendContent`, `vaultPatchContent`, `vaultDeleteFile`, `vaultOpenFile`
- `periodicGetNote`, `periodicCreateNote`, `periodicAppendContent`, `periodicPatchContent`, `periodicDeleteNote`
- `activeFileGet`, `activeFileUpdate`, `activeFileAppend`, `activeFilePatch`, `activeFileDelete`
- `searchSimple`, `searchAdvanced`
- `commandsList`, `commandsExecute`

### AC4 — Função register*Tools curta

Para cada módulo, a função `register<Nome>Tools` deve ter no máximo 60 linhas (corpo da função, sem contar imports). Isso é consequência natural da extração; o limite serve como guard rail.

Verificação: contagem manual ou `awk` simples no arquivo.

### AC5 — Handlers nomeados são funções top-level

Em cada `<modulo>.tools.ts`, deve haver pelo menos N funções `async function handle*` (N = número de tools do módulo) declaradas no escopo do módulo, antes de `register*Tools`.

| Módulo | N handlers esperados |
|--------|----------------------|
| `commands` | 2 |
| `active-file` | 5 |
| `search` | 2 |
| `periodic` | 5 |
| `vault` | 8 |

### AC6 — ObsidianClient com API pública inalterada

Quando `executeRequest` é refatorado, o sistema deve continuar expondo exatamente os métodos públicos: `fetchJson<T>`, `fetchText`, `fetchVoid`, `encodePath`. Assinaturas e tipos de retorno permanecem idênticos. `executeRequest` permanece privado.

Verificação: `grep -E "^\s+(async\s+)?(fetchJson|fetchText|fetchVoid|encodePath)\b" src/shared/obsidian-client.ts` retorna as quatro assinaturas atuais sem alterações.

### AC7 — formatObsidianError com no máximo 4 ramos diretos

A função `formatObsidianError` deve ter no máximo 4 `if`/`return` diretos no corpo principal, delegando lógica complexa a helpers privados. Verificação: leitura do arquivo + `std_review` retornando 0 warnings para `errors.ts`.

### AC8 — Sem comentários adicionados

`git diff main..HEAD -- src/` no PR final não deve introduzir nenhuma linha começando com `//` ou `/*` que seja adicionada (linhas removidas tudo bem). Verificação:
```
git diff main..HEAD -- src/ | grep -E "^\+\s*(//|/\*)" | wc -l
```
Resultado esperado: `0`.

### AC9 — Smoke manual: setup interativo continua funcionando

Quando o usuário roda `node build/index.js --setup` após o refactor, o sistema deve apresentar os mesmos 4 prompts (API Key, Host, Porta, Protocolo) com os mesmos defaults e gravar `~/.obsidian-mcp.json` com a mesma estrutura.

### AC10 — Smoke manual: pelo menos uma tool de cada módulo executada

Após o refactor completo, o usuário roda manualmente:
- `vaultListFiles` (sem path) → retorna listagem JSON da raiz.
- `periodicGetNote period=daily` → retorna a daily note ou erro 404 amigável.
- `activeFileGet` → retorna o arquivo ativo ou erro amigável.
- `searchSimple query="teste"` → retorna resultados formatados ou "Nenhum resultado".
- `commandsList` → retorna lista de comandos.

Cada uma deve produzir saída idêntica (em forma) ao comportamento pré-refactor.

## Out of Scope
## Restrições explícitas (fora de escopo)

Este refactor é estritamente interno. **Não estão neste escopo:**

1. **Adicionar testes automatizados.** O projeto não tem `test` script no `package.json` e instalar Vitest/bun:test fica para outra spec. Aceite é via `std_review` + smoke manual.

2. **Mudar nomes, descrições ou schemas de tools MCP.** Qualquer divergência byte-a-byte do contrato atual é violação. Inclui não consolidar o schema PATCH em `shared/` (mantém um por módulo).

3. **Mudar a API pública de `ObsidianClient`.** `fetchJson`, `fetchText`, `fetchVoid`, `encodePath` permanecem. Apenas o privado `executeRequest` é reorganizado.

4. **Trocar `safeTool` por outro adapter.** O wrapper continua sendo a forma de transformar handlers em respostas MCP com `isError`. Mover a chamada de `safeTool` para dentro do handler é mudança de design fora deste escopo.

5. **Refatorar `index.ts`.** O bootstrap atual (registrar 5 módulos sequencialmente) já está dentro dos limites de clean-code. Não é alvo.

6. **Refatorar `config.ts`.** Já está dentro de limites. Não é alvo.

7. **Migrar para outro runtime de build.** Continua `bun run build`. Não troca para `tsc` puro nem para `esbuild`.

8. **Mexer em `types.ts`.** Permanece como está.

9. **Bump de versão semver.** Refactor interno sem mudança de comportamento observável → não publica versão nova no npm dentro deste PR. O bump fica para a próxima spec que efetivamente adicionar feature.

10. **Adicionar logs/telemetria/instrumentação.** Comportamento de stderr permanece como hoje (apenas `console.error("Obsidian MCP server running on stdio")` no bootstrap).

## Decisões arquiteturais

### D1 — Nome dos handlers extraídos: `handle<ToolName>` `[default]`

Justificativa: padrão verbo+objeto, alinhado com o nome da tool MCP correspondente. Alternativa considerada: `<toolName>Handler` (sufixo). Rejeitado porque o LAD.md global pede verbos para funções.

### D2 — `safeTool` permanece no `register*Tools`, não dentro do handler `[default]`

Justificativa: `safeTool` é o adapter de erros para o contrato MCP. Manter na camada de registro deixa o handler com tipo de retorno `Promise<ToolResult>` puro e testável isoladamente (quando houver testes). Alternativa considerada: aplicar `safeTool` dentro do próprio handler. Rejeitada porque acopla o handler ao adapter MCP e não reduz nesting na função orquestradora.

### D3 — Schema PATCH duplicado por módulo, com `patchFields` local `[default]`

Justificativa: o schema PATCH aparece em 3 lugares (vault, periodic, active-file) com shape idêntico. Mover para `shared/` poderia tecnicamente preservar o schema, mas introduz acoplamento conceitual e risco de divergência futura silenciosa entre os módulos. Optado por extrair os campos comuns como constante local (`patchFields`) em cada arquivo e fazer spread no schema de cada tool específica. Reduz duplicação intra-arquivo, mantém isolamento entre módulos. Alternativa considerada: schema único em `src/shared/patch-schema.ts` exportando `patchFieldsSchema`. Marcado como follow-up (ver context.md), pois pode ser endereçado quando uma quarta tool com PATCH aparecer.

### D4 — Decomposição de `executeRequest` em três helpers privados do arquivo `[default]`

Justificativa: três responsabilidades distintas (montar headers, executar fetch, ler body de erro) que hoje compartilham um escopo. Extrair para funções privadas do mesmo arquivo (não exportadas) mantém o arquivo coeso e elimina nesting sem inflar a superfície pública. Alternativa considerada: criar um novo arquivo `http-helpers.ts`. Rejeitada porque adiciona um arquivo só para esconder 3 funções de 5 linhas cada.

### D5 — `createPrompt` dividido em `createLineBuffer` + `createAsk` `[default]`

Justificativa: hoje `createPrompt` mistura adapter de readline, buffer mutável e factory de função de prompt. Separar em buffer (estado) e ask (uso do estado) torna cada peça <15 linhas e elimina o nesting da fila `waiting`. Alternativa considerada: deixar como está. Rejeitada porque é fácil de quebrar a separação durante manutenção futura e o arquivo já está sendo lido neste refactor — custo marginal baixo.

### D6 — Ordem incremental: menor para maior `[default]`

Justificativa: começar por `commands` (30 linhas, 2 tools) reduz risco de descobrir tarde que o padrão de extração tem problema. Cada commit fica pequeno e revisável. Sequência: `commands` → `active-file` → `search` → `periodic` → `vault` → `errors.ts` → `obsidian-client.ts` → `setup.ts`. Alternativa considerada: começar por `shared/` primeiro. Rejeitada porque mudanças em `shared/` (mesmo internas) afetam todos os módulos no momento de revisar, aumentando o blast radius perceptível dos primeiros commits.

### D7 — Sem mudanças em `index.ts` e em `config.ts` `[default]`

Justificativa: ambos já estão dentro de limites de clean-code. Tocar neles aumentaria escopo sem ganho.

### D8 — Build continua via `bun run build` `[default]`

Justificativa: é o que o `package.json` define. Não é objetivo deste refactor uniformizar para `tsc`. O `tsconfig.json` é apenas referência para o language server e tipos.

### D9 — Aceite via `std_review` + smoke manual `[default]`

Justificativa: não há testes automatizados no projeto. Adicioná-los está explicitamente fora de escopo (item 1). `std_review` é a ferramenta oficial do LAD para validar clean-code; smoke manual cobre regressões funcionais visíveis.
