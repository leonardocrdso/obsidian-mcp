# SPEC-002: Obsidian CLI Tools

**Status:** in-progress
**Created:** 2026-05-23T05:28:37.739Z
**Updated:** 2026-05-23T05:44:54.011Z

## Overview
## Contexto do produto

O `obsidian-mcp` (@leonardocrdso/obsidian-mcp v1.1.2) expõe hoje 22 tools MCP cobrindo o plugin Local REST API do Obsidian. O REST API é estável e cobre 95% das operações comuns de vault, mas tem buracos estruturais: não atualiza wikilinks ao mover/renomear arquivos, não expõe backlinks/outline/orphans, não tem CRUD tipado de frontmatter, não distingue tasks Markdown como entidades e não tem busca grep-style com contexto.

A partir do Obsidian 1.12.7, o app traz um **CLI nativo** (`obsidian <comando>`) que cobre exatamente essas operações com saída JSON estável (flag `format=json`). Esse CLI é ortogonal ao plugin Local REST API: cada um expõe um subconjunto diferente do app, e os dois podem coexistir sem conflito.

Após análise comparativa, a decisão arquitetural foi **estender, não migrar**: manter o REST API como transport principal pras 22 tools atuais (que funcionam e estão estáveis) e adicionar o CLI como segundo transport, exclusivamente para destravar 12 capacidades novas. Migração pura teria custo alto e ganho zero pro usuário final; extensão entrega 12 tools novas sem arriscar o que já está estável.

### Por que agora

O projeto está estável (sem testes, mas com `std_review` limpo após SPEC-001), e o roadmap orgânico do produto pede capacidades que o REST API não tem: usuários relatam wikilinks quebrados ao mover arquivos manualmente, perdem tempo lendo nota inteira só pra ver headings (quando outline resolveria), e não conseguem listar backlinks programaticamente. Atender essas necessidades exige uma fonte de dados que o REST não oferece — o CLI nativo é o caminho de menor resistência.

### Decisão arquitetural raiz: aditivo, não substitutivo

Esta spec **não toca** em:
- `src/shared/obsidian-client.ts` (REST client)
- `src/modules/{vault,search,periodic,commands,active-file,project}/*.tools.ts` em lógica existente
- Contratos das 22 tools atuais (nomes, descrições, schemas Zod)

Toques permitidos e mínimos:
- `src/index.ts` — wiring dos novos módulos (linhas adicionadas, nenhuma modificada).
- `src/modules/search/search.tools.ts` — adição de um handler novo (`handleSearchContext`) e uma chamada `server.tool` extra dentro de `registerSearchTools`. Lógica das tools existentes (`searchSimple`, `searchAdvanced`) permanece intocada byte-a-byte.
- `src/shared/config.ts` e `src/shared/setup.ts` — adição de `cliPath` opcional (campo novo, sem alterar fluxo existente).

### Restrições herdadas do contexto

- Pacote npm publicado: as 22 tools existentes mantêm contrato byte-a-byte. As 12 novas são adições puras.
- Regra global CLAUDE.md: sem comentários no código; código autoexplicativo.
- MCPs `clean-code` e `modular-monolith` consultados ao codar (fase de implementação).
- Sem testes automatizados no projeto hoje — esta spec introduz testes apenas pros pontos de risco real (parse de JSON volátil do CLI, spawn handling), via `bun:test` built-in.
- Build via `bun run build`. Runtime de produção: Node (do `bun build --target node`). Dev: Bun. `child_process` funciona idêntico em ambos.
- Obsidian mínimo: 1.12.7 (versão que introduziu o CLI nativo). Documentar no README.


## Requirements
## Comportamento esperado

Após a implementação, o servidor MCP `obsidian-mcp` expõe **34 tools** no total: as 22 atuais (REST API, inalteradas) + **12 novas** servidas via CLI nativo do Obsidian. Cada tool nova segue exatamente o mesmo template visual e de erro que as existentes (uso de `safeTool`, `safeCli` análogo para o transport CLI, retorno `{ content: [{ type: "text", text: ... }] }`).

No boot do servidor:
1. O `getConfig()` carrega config (REST + CLI) de `~/.obsidian-mcp.json` ou env vars.
2. Um probe único `ObsidianCliClient.isAvailable()` executa `<cliPath> --version` com timeout curto e cacheia o resultado booleano por toda a vida do processo.
3. Os 4 módulos novos (`file-ops`, `graph`, `properties`, `tasks`) e a tool nova `searchContext` são registrados **sempre**, independente da disponibilidade do CLI. Se o probe falhou, cada uma retorna mensagem amigável ao ser chamada ("Obsidian CLI não disponível. Configure `OBSIDIAN_CLI_PATH` ou instale o Obsidian >= 1.12.7.") sem tentar spawn.

As 12 tools novas, agrupadas:

**file-ops/** (2):
- `vaultMoveFile { from: string, to: string }` → executa `obsidian move file=<from> to=<to>`, retorna confirmação com path final.
- `vaultRenameFile { path: string, newName: string }` → executa `obsidian rename file=<path> name=<newName>`, retorna confirmação com path final.

**graph/** (4):
- `vaultBacklinks { path: string }` → executa `obsidian backlinks file=<path> format=json`, retorna JSON listando notas que linkam a `path`.
- `vaultOutline { path: string }` → executa `obsidian outline file=<path> format=json`, retorna lista de headings (level + texto + linha).
- `vaultUnresolvedLinks {}` → executa `obsidian unresolved format=json`, retorna lista de links quebrados do vault inteiro.
- `vaultOrphans {}` → executa `obsidian orphans format=json`, retorna lista de notas sem inbound links.

**properties/** (3):
- `propertyGet { path: string, key: string }` → executa `obsidian property:read file=<path> key=<key> format=json`, retorna `{ key, value, type }`.
- `propertySet { path: string, key: string, value: string | number | boolean | string[], type?: "text" | "number" | "checkbox" | "list" | "date" }` → executa `obsidian property:set file=<path> key=<key> value=<value> [type=<type>]`, retorna confirmação.
- `propertyRemove { path: string, key: string }` → executa `obsidian property:remove file=<path> key=<key>`, retorna confirmação.

**tasks/** (2):
- `tasksList { path?: string, status?: "open" | "done" | "all" }` → executa `obsidian tasks [file=<path>] [status=<status>] format=json`, retorna lista de tasks com `{ ref, text, status, path, line }`.
- `taskToggle { ref: string }` → executa `obsidian task ref=<ref> toggle`, retorna `{ ref, newStatus }`.

**search/ (extensão, +1)**:
- `searchContext { query: string, contextLines?: number }` → executa `obsidian search:context query=<query> [context=<contextLines>] format=json`, retorna lista de matches com `{ path, line, before: string[], match: string, after: string[] }`.

O comportamento de cada tool perante erro do CLI:
- Exit code não-zero → erro `ObsidianCliError` com `stderr` truncado e o comando exato executado (sem o conteúdo de paths sensíveis, mas com nome da subcommand e flags).
- stdout que não casa com o schema Zod do retorno esperado → erro `ObsidianCliSchemaError` com diff resumido e o comando exato executado.
- Timeout (>30s, configurável) → erro `ObsidianCliTimeoutError` com o comando exato.
- CLI ausente (`isAvailable()` retornou `false`) → mensagem amigável padrão sem tentar spawn.

## Requisitos

### R1 — Novo client `ObsidianCliClient` em `src/shared/obsidian-cli.ts`

Cria-se um novo arquivo `src/shared/obsidian-cli.ts` exportando a classe `ObsidianCliClient`. A classe é independente do `ObsidianClient` REST: nenhuma herança, nenhuma composição. Métodos públicos:

- `constructor(cliPath: string, defaults?: { timeoutMs?: number })` — recebe path absoluto pro binário; default `timeoutMs = 30000`.
- `isAvailable(): Promise<boolean>` — executa `<cliPath> --version` com timeout de 5 segundos. Cacheia o primeiro resultado em variável de instância privada (`#availabilityCache: boolean | null`). Chamadas subsequentes retornam o cache. Boot chama uma vez; tools consultam via getter `available` (sync).
- `run<T>(args: string[], schema: ZodSchema<T>): Promise<T>` — spawn de `<cliPath>` com `args`, força `format=json` se não estiver presente, lê stdout, valida com `schema.parse(JSON.parse(stdout))`, retorna `T`. Em qualquer falha, lança `ObsidianCliError` / `ObsidianCliSchemaError` / `ObsidianCliTimeoutError` com `command` contendo `<cliPath> <args.join(" ")>` truncado a 200 chars.
- `runVoid(args: string[]): Promise<void>` — variante sem retorno (para `move`, `rename`, `property:set`, `property:remove`, `task toggle`). Verifica exit code 0; ignora stdout.

Detalhes:
- Usa `node:child_process` `spawn` (não `exec` — evita shell injection). `args` é array; nunca string interpolada.
- `stdio: ["ignore", "pipe", "pipe"]`. Captura `stdout` e `stderr` como buffers, concatena e converte para string ao final.
- Timeout via `AbortController` passado ao `spawn` (Node 16+). Se acionado, mata o processo e lança `ObsidianCliTimeoutError`.

### R2 — Erros tipados em `src/shared/obsidian-cli.ts`

Três classes de erro, todas estendendo `Error`:

- `ObsidianCliError { command: string, exitCode: number, stderr: string }` — exit code não-zero.
- `ObsidianCliSchemaError { command: string, issues: string }` — JSON inválido ou schema Zod falhou. `issues` é resumo legível das `ZodIssue[]`.
- `ObsidianCliTimeoutError { command: string, timeoutMs: number }` — timeout acionado.

Cada classe seta `name` corretamente para serialização. Mensagem padrão de cada uma inclui o `command` truncado.

### R3 — Tratamento de erro CLI em `src/shared/errors.ts`

Estende `formatObsidianError` para tratar os três novos tipos de erro. Acréscimo: três funções privadas `resolveCliErrorMessage(error: ObsidianCliError): string`, `resolveCliSchemaMessage`, `resolveCliTimeoutMessage`. O dispatcher `formatObsidianError` ganha um ramo `error instanceof ObsidianCliError → resolveCliErrorMessage(error)` (e similar para as outras duas).

**Não toca** na lógica existente do `formatObsidianError` para `ObsidianApiError` e `TypeError` de network. Só adiciona ramos novos.

Helper `safeCli` espelha `safeTool` mas é apenas um alias semântico que deixa explícito que aquele handler usa o transport CLI. Implementação: idêntica a `safeTool`. (Decisão: alias e não função separada porque a lógica é a mesma; o alias serve pra documentação visual no código de cada handler.)

### R4 — Config estendida em `src/shared/config.ts` e `src/shared/setup.ts`

`SavedConfig` ganha campo opcional `cliPath?: string`. `loadConfig()` resolve `cliPath` na seguinte ordem:
1. `~/.obsidian-mcp.json` campo `cliPath`.
2. `process.env.OBSIDIAN_CLI_PATH`.
3. String literal `"obsidian"` (depende do PATH).

`runSetup()` adiciona um quinto prompt: `ask("Caminho do CLI", existing?.cliPath ?? "obsidian")`. Persistido no JSON.

### R5 — Módulo `file-ops/` com `vaultMoveFile` e `vaultRenameFile`

Cria `src/modules/file-ops/`:
- `index.ts` — re-exporta `registerFileOpsTools`.
- `file-ops.tools.ts` — segue o padrão SPEC-001 (handlers nomeados, schemas Zod constantes, `registerFileOpsTools(server, cliClient)` orquestrador linear).

Tools:
- `vaultMoveFile { from: string, to: string }`
- `vaultRenameFile { path: string, newName: string }`

Ambas usam `cliClient.runVoid([...])` e retornam confirmação textual com path final.

Nomes começam com `vault*` por semântica (operação sobre vault); arquivo/módulo é organização interna.

### R6 — Módulo `graph/` com 4 tools de leitura

Cria `src/modules/graph/`:
- `index.ts` — re-exporta `registerGraphTools`.
- `graph.tools.ts` — handlers + schemas + orquestrador.
- `graph.types.ts` — schemas Zod do **retorno do CLI** (validação) e tipos inferidos.

Tools:
- `vaultBacklinks { path: string }`
- `vaultOutline { path: string }`
- `vaultUnresolvedLinks {}` (params opcional ou vazio)
- `vaultOrphans {}`

Schemas de retorno (Zod, em `graph.types.ts`):
```
BacklinksResult = z.object({ file: z.string(), backlinks: z.array(z.object({ path: z.string(), line: z.number().optional(), context: z.string().optional() })) })
OutlineResult = z.object({ file: z.string(), headings: z.array(z.object({ level: z.number().min(1).max(6), text: z.string(), line: z.number() })) })
UnresolvedLinksResult = z.object({ links: z.array(z.object({ source: z.string(), target: z.string(), line: z.number().optional() })) })
OrphansResult = z.object({ files: z.array(z.string()) })
```

**Risco conhecido (ver D-Riscos):** o schema exato do CLI 1.12.7 não está documentado publicamente. Schemas acima são uma proposta inicial baseada em convenções típicas de CLIs Obsidian-like. Implementação valida e ajusta no primeiro contato; se schema real divergir significativamente, atualiza-se Zod e adiciona-se task de regressão.

### R7 — Módulo `properties/` com 3 tools

Cria `src/modules/properties/`:
- `index.ts` — re-exporta `registerPropertiesTools`.
- `properties.tools.ts` — handlers + schemas + orquestrador.
- `properties.types.ts` — schemas Zod de retorno.

Tools:
- `propertyGet { path: string, key: string }` — retorna `{ key, value, type }`.
- `propertySet { path: string, key: string, value: string | number | boolean | string[], type?: "text" | "number" | "checkbox" | "list" | "date" }` — runVoid.
- `propertyRemove { path: string, key: string }` — runVoid.

Schema de retorno do `propertyGet`:
```
PropertyValue = z.union([z.string(), z.number(), z.boolean(), z.array(z.string())])
PropertyType = z.enum(["text", "number", "checkbox", "list", "date"])
PropertyReadResult = z.object({ key: z.string(), value: PropertyValue.nullable(), type: PropertyType })
```

Construção do argv para `propertySet`: arrays viram CSV (`a,b,c`) ou são passados como `value=a value=b value=c` conforme convenção do CLI 1.12.7. **Lacuna conhecida:** convenção exata depende do CLI real. Implementação testa contra CLI real; se a convenção difere, adapta. Documentado em context.md como follow-up.

### R8 — Módulo `tasks/` com 2 tools

Cria `src/modules/tasks/`:
- `index.ts` — re-exporta `registerTasksTools`.
- `tasks.tools.ts` — handlers + schemas + orquestrador.
- `tasks.types.ts` — schemas Zod.

Tools:
- `tasksList { path?: string, status?: "open" | "done" | "all" }` — retorna `Task[]`.
- `taskToggle { ref: string }` — retorna `{ ref, newStatus }`.

Schemas:
```
Task = z.object({ ref: z.string(), text: z.string(), status: z.enum(["open", "done"]), path: z.string(), line: z.number() })
TasksListResult = z.object({ tasks: z.array(Task) })
TaskToggleResult = z.object({ ref: z.string(), newStatus: z.enum(["open", "done"]) })
```

### R9 — `searchContext` no módulo `search/` existente

Adiciona handler `handleSearchContext` em `src/modules/search/search.tools.ts` e uma chamada `server.tool("searchContext", ...)` dentro de `registerSearchTools`. Assinatura de `registerSearchTools` muda de `(server, client: ObsidianClient)` para `(server, client: ObsidianClient, cliClient: ObsidianCliClient)`.

Os dois handlers existentes (`handleSearchSimple`, `handleSearchAdvanced`) permanecem **byte-a-byte idênticos**. Toda alteração no arquivo é puramente aditiva (linhas novas, nenhuma linha removida ou modificada).

Schema do retorno:
```
SearchContextMatch = z.object({ path: z.string(), line: z.number(), before: z.array(z.string()), match: z.string(), after: z.array(z.string()) })
SearchContextResult = z.object({ matches: z.array(SearchContextMatch) })
```

### R10 — Wiring em `src/index.ts`

Adiciona-se ao bootstrap:
```
import { ObsidianCliClient } from "./shared/obsidian-cli.js";
import { registerFileOpsTools } from "./modules/file-ops/index.js";
import { registerGraphTools } from "./modules/graph/index.js";
import { registerPropertiesTools } from "./modules/properties/index.js";
import { registerTasksTools } from "./modules/tasks/index.js";

const cliClient = new ObsidianCliClient(config.cliPath);
await cliClient.isAvailable();

registerFileOpsTools(server, cliClient);
registerGraphTools(server, cliClient);
registerPropertiesTools(server, cliClient);
registerTasksTools(server, cliClient);
```

A linha existente `registerSearchTools(server, client);` muda para `registerSearchTools(server, client, cliClient);`. Demais linhas inalteradas.

A chamada `await cliClient.isAvailable()` no boot serve apenas para popular o cache. Não falha o boot se o CLI não está disponível — o `Promise<boolean>` resolve `false`.

### R11 — Detecção e cache de disponibilidade

`ObsidianCliClient.isAvailable()`:
- Tenta `spawn(cliPath, ["--version"])` com timeout 5000ms.
- Sucesso (exit code 0): cacheia `true`, retorna `true`.
- Qualquer falha (binário inexistente, exit code não-zero, timeout, exception): cacheia `false`, retorna `false`. Não lança.
- Após primeira chamada, retorna do cache sem novo spawn.
- Getter `available: boolean` retorna cache. Lança `Error("isAvailable() not called yet")` se acessado antes de qualquer chamada a `isAvailable()`.

Cada handler das 12 tools inicia com:
```
if (!cliClient.available) {
  return { content: [{ type: "text", text: "Obsidian CLI não disponível. Configure OBSIDIAN_CLI_PATH ou instale o Obsidian >= 1.12.7." }], isError: true };
}
```

### R12 — Validação Zod com erro contextual

Toda chamada `cliClient.run<T>(args, schema)` valida o JSON parseado contra o `schema` Zod. Falha na validação lança `ObsidianCliSchemaError` cujo `message` cita:
1. O comando exato executado (`<cliPath> <args.join(" ")>` truncado a 200 chars).
2. Os primeiros 3 issues do Zod formatados como `path → mensagem` (ex.: `headings[0].level → expected number, got string`).
3. Os primeiros 200 chars do stdout recebido (para debug visual).

### R13 — Testes via `bun:test`

Adiciona-se `tests/obsidian-cli.test.ts` e `tests/cli-schemas.test.ts`. Sem dependência nova (usa o runtime `bun:test` built-in).

`obsidian-cli.test.ts` cobre (com `child_process.spawn` mockado):
- `isAvailable()` cacheia true após primeiro sucesso.
- `isAvailable()` cacheia false após primeiro erro (sem relançar).
- `run<T>` lança `ObsidianCliError` quando exit code != 0.
- `run<T>` lança `ObsidianCliTimeoutError` quando AbortController dispara.
- `run<T>` lança `ObsidianCliSchemaError` quando stdout não casa com schema.
- `run<T>` retorna `T` parseado quando exit 0 + JSON válido + schema OK.
- `runVoid` retorna `void` quando exit 0; lança `ObsidianCliError` quando exit != 0.

`cli-schemas.test.ts` cobre (com payloads JSON literais):
- Cada schema Zod (`BacklinksResult`, `OutlineResult`, `UnresolvedLinksResult`, `OrphansResult`, `PropertyReadResult`, `Task`, `TasksListResult`, `TaskToggleResult`, `SearchContextResult`) parseia corretamente um payload válido conhecido e rejeita payloads malformados (campo faltando, tipo errado).

Script `test` adicionado ao `package.json`: `"test": "bun test"`.

### R14 — README atualizado

`README.md` ganha:
- Seção "Requirements": Obsidian >= 1.12.7 (caso queira usar as tools CLI-based).
- Seção "CLI Tools": tabela com as 12 tools novas e descrição curta de cada.
- Nota: "tools CLI-based ficam dormentes se o CLI não está disponível — REST API continua funcionando independentemente".

### R15 — Contrato MCP existente preservado

Para cada uma das 22 tools atuais, a chamada `server.tool(name, description, schema, handler)` produz exatamente os mesmos `name`, `description`, e `schema` Zod. Verificação: `diff` entre tools listadas pelo servidor antes/depois é vazio para nomes/descrições/schemas das 22 originais. As 12 novas são adições puras.

### R16 — Zero comentários adicionados

Por regra global do projeto. Nenhuma linha começando com `//` ou `/*` é adicionada em código de produção (testes seguem mesma regra para consistência).

### R17 — Sem mudança no bump de versão dentro desta spec

Esta spec **adiciona feature**. Bump de versão semver é `1.2.0` (minor bump por feature aditiva), mas a publicação ao npm é responsabilidade de spec/processo separado. Esta spec deixa `package.json` em `1.2.0` mas **não publica**.


## Acceptance Criteria
## Critérios de aceitação testáveis

Cada AC abaixo deve ser verificável por comando ou observação direta após a implementação completa. Os ACs seguem variantes EARS quando aplicável.

### AC1 — Servidor MCP expõe 34 tools (22 antigas + 12 novas)

O sistema deve registrar exatamente 34 tools no servidor MCP, sendo as 22 atuais com nome/descrição/schema inalterados e as 12 novas com os nomes listados abaixo.

Comando de verificação (smoke manual via cliente MCP):
- 22 atuais: `vaultListFiles`, `vaultGetFile`, `vaultGetMetadata`, `vaultCreateFile`, `vaultAppendContent`, `vaultPatchContent`, `vaultDeleteFile`, `vaultOpenFile`, `periodicGetNote`, `periodicCreateNote`, `periodicAppendContent`, `periodicPatchContent`, `periodicDeleteNote`, `activeFileGet`, `activeFileUpdate`, `activeFileAppend`, `activeFilePatch`, `activeFileDelete`, `searchSimple`, `searchAdvanced`, `commandsList`, `commandsExecute`, `projectInit`.
- 12 novas: `vaultMoveFile`, `vaultRenameFile`, `vaultBacklinks`, `vaultOutline`, `vaultUnresolvedLinks`, `vaultOrphans`, `propertyGet`, `propertySet`, `propertyRemove`, `tasksList`, `taskToggle`, `searchContext`.

(Nota: A lista das 22 originais corresponde ao que o servidor expõe hoje, incluindo `projectInit` do módulo `project/` descoberto durante a exploração. Em SPEC-001 a contagem mencionada era 22, e essa contagem é preservada.)

### AC2 — Quando o CLI está disponível, cada tool nova executa o comando esperado

Quando o usuário invoca cada tool nova com parâmetros válidos e o CLI está disponível, o sistema deve executar o comando CLI correto e retornar o resultado parseado.

Verificação (smoke manual contra Obsidian 1.12.7+):
- `vaultMoveFile from="A.md" to="Subpasta/A.md"` → arquivo movido, wikilinks atualizados, resposta confirma path final.
- `vaultRenameFile path="A.md" newName="B.md"` → arquivo renomeado.
- `vaultBacklinks path="A.md"` → JSON com lista de backlinks.
- `vaultOutline path="A.md"` → JSON com lista de headings.
- `vaultUnresolvedLinks` → JSON com lista de links quebrados.
- `vaultOrphans` → JSON com lista de notas órfãs.
- `propertyGet path="A.md" key="status"` → JSON `{ key, value, type }`.
- `propertySet path="A.md" key="status" value="done" type="text"` → confirmação.
- `propertyRemove path="A.md" key="status"` → confirmação.
- `tasksList` → JSON com array de tasks do vault.
- `tasksList path="A.md" status="open"` → JSON filtrado.
- `taskToggle ref="<ref>"` → JSON `{ ref, newStatus }`.
- `searchContext query="TODO" contextLines=2` → JSON com matches contendo before/after.

### AC3 — Se o CLI está ausente, então cada tool nova deve retornar erro amigável sem spawn

Se `isAvailable()` retornou `false` no boot, então qualquer invocação das 12 tools novas deve retornar resposta com `isError: true` e mensagem contendo o texto literal "Obsidian CLI não disponível". O sistema **não deve** tentar `spawn` nessas chamadas (verificável via mock/spy em `child_process.spawn` durante o teste).

### AC4 — O sistema deve continuar funcional quando o CLI está ausente

Enquanto o CLI está ausente, o sistema deve continuar respondendo normalmente para todas as 22 tools antigas (REST API). Verificação: smoke manual de pelo menos uma tool de cada módulo REST (`vaultListFiles`, `periodicGetNote period=daily`, `activeFileGet`, `searchSimple query="teste"`, `commandsList`, `projectInit projectName="x" basePath="z"`) executa com o mesmo resultado esperado pré-feature.

### AC5 — Quando o CLI retorna exit code não-zero, então o sistema lança ObsidianCliError

Quando o CLI executado retorna exit code != 0, o sistema deve lançar `ObsidianCliError` capturado por `safeCli` e exposto ao usuário como mensagem contendo:
- O comando executado (truncado a 200 chars).
- O exit code.
- O `stderr` (truncado a 500 chars).

Verificação: teste `bun test` em `tests/obsidian-cli.test.ts`.

### AC6 — Quando o stdout do CLI não casa com o schema Zod, então o sistema lança ObsidianCliSchemaError

Quando `JSON.parse(stdout)` sucede mas `schema.parse(...)` falha, o sistema deve lançar `ObsidianCliSchemaError` com mensagem contendo:
- O comando executado.
- Os 3 primeiros issues do Zod formatados.
- Os 200 primeiros chars do stdout.

Verificação: teste em `tests/obsidian-cli.test.ts`.

### AC7 — Quando o CLI demora mais que o timeout, então o sistema lança ObsidianCliTimeoutError

Quando o CLI executa por mais de `timeoutMs` (default 30000ms), o sistema deve abortar o processo e lançar `ObsidianCliTimeoutError`. Verificação: teste em `tests/obsidian-cli.test.ts` usando mock que nunca exit.

### AC8 — `isAvailable()` cacheia resultado da primeira chamada

O sistema deve executar `<cliPath> --version` exatamente uma vez por processo, independente de quantas vezes `isAvailable()` é chamado. Verificação: teste com spy no `child_process.spawn`.

### AC9 — `bun run build` passa após implementação completa

Após implementação, `bun run build` deve terminar com exit code 0 e gerar `build/index.js` carregável (`node build/index.js --setup` mostra os 5 prompts; `node build/index.js` com config válida sobe o servidor).

### AC10 — `bun test` passa com todos os testes verdes

Após implementação, `bun test` deve executar e reportar todos os testes verdes em `tests/obsidian-cli.test.ts` e `tests/cli-schemas.test.ts`.

### AC11 — `std_review` sem warnings nos arquivos novos

Quando `std_review` é executado nos arquivos novos (`src/shared/obsidian-cli.ts`, `src/modules/file-ops/file-ops.tools.ts`, `src/modules/graph/graph.tools.ts`, `src/modules/properties/properties.tools.ts`, `src/modules/tasks/tasks.tools.ts`, `src/modules/graph/graph.types.ts`, `src/modules/properties/properties.types.ts`, `src/modules/tasks/tasks.types.ts`), o sistema não deve reportar warnings de `function-length`, `nesting-depth`, ou `magic-numbers` para esses paths.

### AC12 — `std_review` sem regressão nos arquivos tocados

Quando `std_review` é executado nos arquivos que sofreram adição (`src/shared/config.ts`, `src/shared/setup.ts`, `src/shared/errors.ts`, `src/modules/search/search.tools.ts`, `src/index.ts`), o sistema não deve reportar warning novo comparado ao estado pré-feature.

### AC13 — Sem comentários adicionados

`git diff main..HEAD -- src/ tests/` não introduz nenhuma linha começando com `//` ou `/*` adicionada. Comando:
```
git diff main..HEAD -- src/ tests/ | grep -E "^\+\s*(//|/\*)" | wc -l
```
Resultado esperado: `0`.

### AC14 — `runSetup` interativo prompta o cliPath

Quando o usuário roda `node build/index.js --setup` após a feature, o sistema deve apresentar 5 prompts (API Key, Host, Porta, Protocolo, Caminho do CLI) na ordem listada, com defaults respeitando valores existentes em `~/.obsidian-mcp.json`, e gravar todos os campos.

### AC15 — Args do CLI escapam corretamente paths com espaços e caracteres especiais

Quando uma tool é invocada com `path` contendo espaços, acentos ou caracteres que normalmente teriam interpretação especial em shell (`$`, `&`, `;`, etc.), o sistema deve passar o argumento via array `args` ao `spawn` (sem shell), preservando o conteúdo literal. Verificação: teste em `tests/obsidian-cli.test.ts` validando que `args` é array e nunca passa por shell.

### AC16 — README cita versão mínima 1.12.7 e tabela de tools novas

O `README.md` após a feature deve conter:
- Texto contendo `1.12.7` em seção visível.
- Tabela ou lista markdown com os 12 nomes de tools novas.

Verificação: `grep -E "1\.12\.7|vaultMoveFile|vaultBacklinks|propertyGet|tasksList|searchContext" README.md` retorna múltiplos hits.

### AC17 — `package.json` bumpado para 1.2.0

A versão em `package.json` deve estar em `1.2.0` (minor bump por feature aditiva), sem publicação ao npm dentro desta spec.

### AC18 — Sem alteração de bytes em handlers de tools existentes

Os handlers `handleSearchSimple` e `handleSearchAdvanced` em `src/modules/search/search.tools.ts` devem permanecer byte-a-byte idênticos ao estado pré-feature. Verificação:
```
git diff main..HEAD -- src/modules/search/search.tools.ts | grep -E "^-" | grep -v "^---" | wc -l
```
Resultado esperado: `0` (nenhuma linha removida ou modificada; apenas adições).

### AC19 — Probe inicial não bloqueia o boot por mais de 5s

Enquanto o servidor faz boot, a chamada `await cliClient.isAvailable()` em `src/index.ts` deve resolver em ≤ 5 segundos (timeout interno). Se o CLI travar/não responder, o boot prossegue (resolve `false`). Verificação: teste manual com `OBSIDIAN_CLI_PATH=/bin/sleep` (ou similar binário lento) — o servidor sobe em ≤ 6s.

### AC20 — Mensagem de erro do CLI cita o comando exato

Se qualquer um dos três tipos de erro (`ObsidianCliError`, `ObsidianCliSchemaError`, `ObsidianCliTimeoutError`) é lançado, então a mensagem formatada pelo `formatObsidianError` deve conter a substring do nome da subcommand CLI executada (ex.: `move`, `backlinks`, `property:read`). Verificação: testes unitários em `tests/obsidian-cli.test.ts` + smoke manual.


## Out of Scope
## Restrições explícitas (fora de escopo)

Esta feature é aditiva. **Não estão neste escopo:**

1. **Migração de qualquer tool existente do REST API para o CLI.** As 22 tools atuais continuam usando exatamente o transport REST atual. Mesmo que o CLI ofereça operação equivalente (ex.: criar arquivo), não há plano de migração.

2. **Refactor de `obsidian-client.ts` (REST client).** Permanece byte-a-byte como saiu da SPEC-001.

3. **Refactor de qualquer módulo existente que não esteja explicitamente listado em R9** (que adiciona `searchContext` ao `search/`). Em particular: `vault/`, `periodic/`, `commands/`, `active-file/`, `project/` não recebem mudanças nesta spec.

4. **Pool de processos persistentes / TUI interativa do CLI.** Decisão arquitetural firme (D1): spawn-por-comando. Otimização para hot path fica para outra spec, **se** medições futuras mostrarem latência problemática.

5. **Caching de retornos do CLI.** Cada invocação chama o CLI. Cache só existe para o probe `isAvailable()`, nada mais.

6. **Estender o módulo `project/` com capacidades CLI.** O módulo `project/` continua REST-only. Quem precisa de move/rename usa as novas tools `vaultMoveFile`/`vaultRenameFile` separadamente.

7. **Testes e2e contra CLI real do Obsidian.** Exige instalação do Obsidian no ambiente de testes (CI) e vault populado. Cobertura via smoke manual e ACs visuais (AC2). Testes unitários cobrem o cliente e os schemas.

8. **Testes por tool (uma test suite para cada handler).** A camada de tools individuais (`*.tools.ts`) é fina (handler → cliClient.run → return). O risco real está no cliente + schemas, que são testados.

9. **Publicação ao npm.** O bump `1.2.0` no `package.json` é declarativo; publicação é outro processo (manual ou outra spec).

10. **Configuração via arquivo TOML/YAML.** Continua JSON (`~/.obsidian-mcp.json`) + env vars. Sem mudança no formato.

11. **Suporte a múltiplos vaults / múltiplos CLIs em paralelo.** Um vault, um CLI path, configurados no boot.

12. **Telemetria, métricas ou logs estruturados.** Continua `console.error("Obsidian MCP server running on stdio")` e nada mais. Erros aparecem na resposta da tool, não em log separado.

13. **Documentação de uso avançado / playbooks de integração.** README ganha apenas o mínimo necessário (versão mínima e lista de tools novas). Tutoriais ficam para fora.

14. **Schema-versioning das respostas CLI.** Se o Obsidian futuramente mudar o JSON do CLI (mudar campo, renomear), a feature **quebra** e exige spec corretiva. Não há camada de adapter intermediário pra absorver versões diferentes do CLI nesta entrega.

15. **Internacionalização de mensagens de erro.** Mensagens em pt-BR conforme `language.interaction: pt-BR` do `.lad/config.json`, sem suporte a outros idiomas.

16. **Renomeação ou consolidação de tools existentes para harmonizar com os nomes novos.** Ex.: ninguém renomeia `vaultDeleteFile` para alinhar com `vaultMoveFile`. Os nomes existentes ficam.

17. **Validação semântica de paths.** O cliente CLI não checa se `from` existe antes de `move`, nem se `to` é um path válido. Erros vêm do próprio CLI via `ObsidianCliError`.

## Decisões arquiteturais

### D1 — Spawn-por-comando (não TUI persistente) `[fixa]`

**Decisão:** Cada invocação de tool spawna um processo CLI novo, lê stdout, espera exit, retorna.

**Justificativa:** Tools são baixa-frequência (usuário invoca manualmente via LLM, não em loop). Overhead de 80–150ms é aceitável. TUI persistente exigiria worker pool, invalidação de cache, gestão de estado entre invocações, race conditions — complexidade alta para ganho marginal. Modular monolith atual é stateless por convenção; TUI persistente quebraria esse contrato.

**Alternativa considerada:** TUI persistente (1 worker por vault, near-zero overhead). Rejeitada conforme acima.

**Reabertura possível:** Se medições futuras em produção mostrarem latência problemática (ex.: usuário invoca `vaultBacklinks` em batch via script), abre-se nova spec para introduzir pool. Não nesta.

### D2 — 12 tools separadas, sem flag `operation` `[fixa]`

**Decisão:** Properties tem 3 tools (`propertyGet`, `propertySet`, `propertyRemove`) e tasks tem 2 (`tasksList`, `taskToggle`), em vez de uma única tool por domínio com flag `operation`.

**Justificativa:** Regra global clean-code "Avoid Flag Arguments" (argumentos enum/booleanos sinalizam que a função faz mais de uma coisa). Padrão atual do projeto também: cada tool MCP = uma operação semântica (`vaultCreateFile`, `vaultDeleteFile`, `vaultAppendContent` são tools separadas, não `vaultMutate` com flag).

**Alternativa considerada:** Agrupar como 2 tools (`property`, `tasks`) com flag. Rejeitada por contradizer a regra e o padrão.

### D3 — Módulo `file-ops/` separado, com nomes de tools `vault*` `[fixa]`

**Decisão:** Cria módulo `src/modules/file-ops/` com tools `vaultMoveFile` e `vaultRenameFile`. Não estende `src/modules/vault/`.

**Justificativa:** Briefing pede "não tocar em `vault.tools.ts`". Padrão do projeto: cada módulo recebe um único client (`ObsidianClient` ou `ObsidianCliClient`, não os dois). Misturar clients no `vault/` quebra a convenção. Por outro lado, o prefixo `vault*` no nome das tools mantém consistência semântica (operação sobre o vault) — usuários e LLMs descobrem as tools junto com as outras `vault*`.

**Alternativa considerada:** Renomear para `fileOpsMove`/`fileOpsRename` para coincidir prefixo de tool com nome do módulo. Rejeitada porque enfraquece descoberta semântica.

**Alternativa considerada:** Estender o `vault/` com segundo client injetado. Rejeitada por quebrar convenção 1-módulo-1-client.

### D4 — `searchContext` no `search/` existente, com `cliClient` adicional `[fixa]`

**Decisão:** Adiciona `handleSearchContext` ao `search.tools.ts`. `registerSearchTools` ganha terceiro parâmetro `cliClient`. Handlers existentes intocados.

**Justificativa:** O domínio é "busca". Criar `search-cli/` fragmentaria a descoberta da tool (cliente MCP teria duas listas de tools de busca). "Aditivo" significa "não altera lógica existente", não "não abre o arquivo".

**Alternativa considerada:** Criar `search-cli/` separado. Rejeitada por fragmentação semântica.

### D5 — CLI ausente: tools registradas, falham com mensagem amigável `[fixa]`

**Decisão:** Quando `isAvailable()` retorna `false`, as 12 tools continuam registradas no servidor MCP, mas cada uma retorna `{ isError: true, content: [{ type: "text", text: "Obsidian CLI não disponível..." }] }` ao ser chamada.

**Justificativa:** Se a tool sumisse, o LLM cliente do MCP poderia tentar caminhos alternativos perigosos (ex.: simular `move` via `delete` + `create`, perdendo wikilinks — exatamente o problema que a feature resolve). Com a tool presente, o LLM vê que ela existe, recebe erro claro, e reporta ao usuário "instale o CLI". Trade-off: lista de tools fica "poluída" se CLI ausente. Aceitável: pior caso é mensagem extra; pior caso da alternativa é corrupção de vault.

**Alternativa considerada:** Não registrar as tools quando CLI ausente. Rejeitada pelo risco de corrupção.

### D6 — Probe de disponibilidade único, cacheado, no boot `[fixa]`

**Decisão:** `isAvailable()` cacheia o resultado da primeira chamada. Boot do servidor chama uma vez; tools consultam via getter `available` (síncrono).

**Justificativa:** Probe a cada invocação seria desperdício (CLI não vai desaparecer entre uma chamada e outra dentro do mesmo processo). Cache no boot mantém latência mínima nas tools.

**Trade-off conhecido:** Se o usuário instala o CLI **depois** do servidor subir, ele precisa reiniciar o servidor para que as tools fiquem ativas. Aceitável: setup de MCP server é raro; restart é trivial.

### D7 — Validação Zod do JSON CLI com mensagem de erro citando comando `[fixa]`

**Decisão:** Toda resposta do CLI passa por schema Zod. Falha lança `ObsidianCliSchemaError` com comando exato + issues Zod resumidos + 200 chars de stdout.

**Justificativa:** Schema do CLI 1.12.7 é instável (não documentado publicamente). Sem validação, divergências de schema causariam erros runtime cripticos. Com validação + mensagem de debug, qualquer divergência é detectada e diagnosticada rápido.

### D8 — Testes só do cliente e dos schemas, via `bun:test` `[fixa]`

**Decisão:** Testes unitários cobrem `ObsidianCliClient` (com spawn mockado) e os schemas Zod (com payloads literais). Tools individuais validadas por smoke manual.

**Justificativa:** Ponto de Pareto entre cobertura e custo. Riscos reais (spawn handling, parse de JSON volátil) ficam cobertos. Tools individuais são camada fina (handler → cliClient.run → return) — pouco a testar isoladamente. `bun:test` é built-in (sem dependência nova).

**Alternativa considerada:** Sem testes (como SPEC-001). Rejeitada porque risco aqui é maior (spawn + parse JSON volátil).

**Alternativa considerada:** Testes e2e contra Obsidian real. Rejeitada (requer Obsidian instalado no CI, vault populado).

### D9 — `ObsidianCliClient` em `src/shared/` (não em módulo próprio) `[default]`

**Decisão:** O cliente CLI vive em `src/shared/obsidian-cli.ts`, espelhando a localização do REST client (`src/shared/obsidian-client.ts`).

**Justificativa:** Padrão atual do projeto: clients são `shared/`. Manter coerência. Alternativa considerada: criar `src/transports/cli.ts` separando "transports". Rejeitada — não há ganho hoje, só adiciona um diretório.

### D10 — `safeCli` como alias de `safeTool` `[default]`

**Decisão:** Adiciona `export const safeCli = safeTool` em `src/shared/errors.ts`. Handlers CLI usam `safeCli`; handlers REST usam `safeTool`.

**Justificativa:** Documentação visual no código (leitor vê `safeCli` e sabe "handler chama CLI"). Implementação idêntica — `formatObsidianError` já trata os erros CLI via dispatch por tipo.

**Alternativa considerada:** Reusar `safeTool` direto. Rejeitada por perder a pista visual.

**Alternativa considerada:** Função separada `safeCli` com lógica diferente. Rejeitada — não há lógica diferente.

### D11 — Naming dos handlers segue padrão SPEC-001 `[default]`

**Decisão:** `handle<ToolName>` em camelCase (ex.: `handleVaultMoveFile`, `handlePropertyGet`).

**Justificativa:** Padrão fixado na SPEC-001. Consistência.

### D12 — Schemas Zod de retorno em `<modulo>.types.ts` `[default]`

**Decisão:** Cada módulo novo com retorno tipado tem `<modulo>.types.ts` declarando schemas Zod do **retorno do CLI** e tipos inferidos. Schemas de **input** da tool MCP continuam inline no `*.tools.ts` (padrão atual).

**Justificativa:** Separa "contrato de saída do CLI" (que pode divergir entre versões) de "contrato de entrada da tool MCP" (que é nosso, estável). Facilita ajuste do schema do CLI sem mexer no resto.

### D13 — Timeout default 30s `[default]`

**Decisão:** `timeoutMs` default no `ObsidianCliClient` é 30000ms.

**Justificativa:** Operações do CLI sobre vaults grandes (ex.: `orphans`, `unresolved`) podem demorar. 30s é generoso para vault típico (até alguns milhares de notas). Boot probe usa timeout menor (5s) porque `--version` é instantâneo.

**Alternativa considerada:** 10s. Rejeitada porque cobre menos casos de vault grande.

**Reabertura:** Se usuário relatar timeout em vaults muito grandes, parametriza via config.

### D14 — Versão mínima Obsidian: 1.12.7 `[default]`

**Decisão:** Documentada no README. Não há check programático da versão do Obsidian — apenas o probe do CLI.

**Justificativa:** 1.12.7 é a primeira versão que ship com CLI nativo. Versões anteriores não têm o binário. Probe `--version` falha → tools dormem → mensagem amigável. Check explícito de versão seria over-engineering.

### D15 — `cliPath` em `~/.obsidian-mcp.json` opcional; default `"obsidian"` `[default]`

**Decisão:** Campo opcional no JSON, opcional no setup (default `"obsidian"`). Resolve via PATH se relativo.

**Justificativa:** Usuário típico tem `obsidian` no PATH após instalação. Power users com instalações custom (Flatpak, AppImage) configuram path absoluto.

### D16 — Bump de versão `1.2.0` `[default]`

**Decisão:** `package.json` vai de `1.1.2` para `1.2.0` (minor por feature aditiva, sem breaking change).

**Justificativa:** SemVer. As 22 tools antigas preservam contrato — não é patch (que seria pra bugfix), não é major (que seria pra breaking).

### D17 — Construção do argv: `key=value` `[default, com lacuna conhecida]`

**Decisão:** Argv segue padrão `obsidian <subcommand> key=value key=value`, refletindo a sintaxe documentada do CLI nativo no help do Obsidian.

**Justificativa:** Convenção do CLI 1.12.7 segundo documentação pública parcial.

**Lacuna conhecida:** Construção exata para `propertySet` com valor `list` (array). Possíveis convenções: CSV (`value=a,b,c`), repetição (`value=a value=b value=c`), JSON inline (`value=["a","b"]`). Implementação testa contra CLI real e escolhe a que funciona; ajuste documentado em `context.md` da spec ao concluir a task correspondente. Não bloqueia a spec porque a decisão é descobrível em tempo de implementação (não exige decisão de produto).

### D18 — Módulo `project/` permanece intocado `[fixa, escopo]`

**Decisão:** O módulo `project/` (descoberto durante exploração; faz `projectInit` via REST) não recebe extensão CLI nesta spec.

**Justificativa:** Briefing original explicitamente focou em 7 capacidades novas; estender `project/` não estava previsto. Mantém escopo bounded. Possível follow-up.

### D19 — `child_process` do Node em runtime Bun e Node `[default]`

**Decisão:** Usa `node:child_process` (`spawn`, `AbortController`). Compatível com Bun (dev) e Node (build/produção).

**Justificativa:** API estável em ambos os runtimes. `bun build --target node` gera bundle Node-compatível.

## Runtime & Packaging

Esta seção documenta o impacto no empacotamento/distribuição do pacote npm.

- [x] Runtime: continua `bun build --target node` → produz `build/index.js` carregável por Node ≥ 18.
- [x] Dependências runtime: nenhuma nova. Mantém `@modelcontextprotocol/sdk` e `zod`.
- [x] Dependências dev: nenhuma nova. `bun:test` é built-in. Tests dev-only.
- [x] Bin entrypoint: `build/index.js` (inalterado).
- [x] `files` no package.json: continua `["build/", "README.md", "LICENSE"]`. Tests não vão para o pacote npm.
- [x] Versão: bump de `1.1.2` → `1.2.0` (minor; feature aditiva).
- [x] Publicação: fora de escopo (manual).
- [x] Suporte de runtime: Node ≥ 18 (já era o caso, herdado).
- [x] Dependência externa de produção: Obsidian app ≥ 1.12.7 com CLI no PATH (ou path configurado). Sem isso, as 12 tools dormem; as 22 antigas continuam.

