# Tasks — Business Rules Module

Ordem incremental: 1 commit por task. Cada task fecha com `bun run build` verde e `std_review` limpo nos arquivos tocados/criados.

## Pré-requisitos

- [ ] `bun install` instalado e funcional na máquina do dev
- [ ] Acesso ao Obsidian rodando localmente com plugin Local REST API ativo (para smoke manual)
- [ ] Vault com pelo menos um projeto em `Projetos/<projeto>/` (criar `Projetos/teste-regras/Regras/` ainda nem é necessário — `PUT` cria pastas)
- [ ] `std_review` MCP disponível na sessão
- [ ] MCPs `clean-code` e `modular-monolith` consultados durante codificação (regra global do projeto)
- [ ] `spec.md` em status `ready`

## Sequência canônica

```
T1 patch-headers (refactor preventivo)
  └─ T2 errors.ts (+3 erros + 3 resolvers)
       └─ T3 business-rules.types.ts
            └─ T4 business-rules.template.ts (slugify, generateId, render, parse)
                 └─ T5 business-rules.links.ts (validate + inject + backlink)
                      └─ T6 business-rules.tools.ts (5 schemas + 5 handlers + register)
                           └─ T7 index.ts do módulo
                                └─ T8 wiring em src/index.ts
                                     └─ T9 CLAUDE.md (seção Regras de Negócio)
                                          └─ T10 README.md (27 tools)
                                               └─ T11 review final + smoke completo
```

T3–T5 são pré-requisito direto de T6. Em fluxo solo, executar em sequência.

---

## T1 — Extrair `buildPatchHeaders` para `src/shared/patch-headers.ts`

Refactor preventivo. Cobre decisão §2 do design.

- [x] `Read src/modules/vault/vault.tools.ts src/modules/periodic/periodic.tools.ts` para confirmar paridade byte-a-byte das duas cópias atuais
- [x] `std_check_impact filePath=src/modules/vault/vault.tools.ts` e `filePath=src/modules/periodic/periodic.tools.ts`
- [x] Consultar MCP `clean-code` antes de codar
- [x] Criar `src/shared/patch-headers.ts`:
  - [x] `export type PatchHeaderParams = { operation: string; targetType: string; target: string; targetDelimiter?: string; trimTargetWhitespace?: boolean; createTargetIfMissing?: boolean }`
  - [x] `export function buildPatchHeaders(params: PatchHeaderParams): Record<string, string>` — implementação byte-a-byte igual à atual
- [x] Em `src/modules/vault/vault.tools.ts`:
  - [x] Remover declaração local `function buildPatchHeaders` e `type PatchHeaderParams`
  - [x] Adicionar `import { buildPatchHeaders } from "../../shared/patch-headers.js";`
- [x] Em `src/modules/periodic/periodic.tools.ts`:
  - [x] Mesma operação (remover local + adicionar import)
- [x] Validar: descrições dos schemas e nomes das tools inalterados (descrição de `target` continua diferente entre vault e periodic — está no schema, não no helper)
- [x] `bun run build` → exit 0
- [x] `std_review` nos 3 arquivos tocados → 0 warnings novos
- [x] Smoke: `vaultPatchContent` e `periodicPatchContent` produzem mesmas mensagens de saída
- [x] Commit: `refactor(shared): extrair buildPatchHeaders para shared/patch-headers`

---

## T2 — Estender `src/shared/errors.ts` com 3 erros do módulo business-rules

Cobre decisão arquitetural sobre erros (spec §Tratamento de erros).

- [x] `Read src/shared/errors.ts`
- [x] `std_check_impact filePath=src/shared/errors.ts`
- [x] Adicionar 3 classes de erro no topo (após `ObsidianApiError`):
  - [x] `export class RuleAlreadyExistsError extends Error { constructor(public readonly path: string) { super(`Regra já existe em ${path}. Use businessRulesUpdate para alterar.`); this.name = "RuleAlreadyExistsError"; } }`
  - [x] `export class RelatedRuleNotFoundError extends Error { constructor(public readonly project: string, public readonly idOrPath: string) { super(`Regra-alvo não encontrada: project=${project}, idOrPath=${idOrPath}. Crie a regra-alvo antes de referenciá-la.`); this.name = "RelatedRuleNotFoundError"; } }`
  - [x] `export class RuleNotFoundError extends Error { constructor(public readonly project: string, public readonly idOrPath: string) { super(`Regra não encontrada em ${project}: ${idOrPath}.`); this.name = "RuleNotFoundError"; } }`
- [x] Adicionar 3 resolvers privados:
  - [x] `function resolveRuleAlreadyExistsMessage(error: RuleAlreadyExistsError): string`
  - [x] `function resolveRelatedRuleNotFoundMessage(error: RelatedRuleNotFoundError): string`
  - [x] `function resolveRuleNotFoundMessage(error: RuleNotFoundError): string`
  - [x] Cada um retorna `[<NomeErro>] ${error.message}` (formato consistente com os existentes)
- [x] Em `formatObsidianError`, adicionar 3 ramos `instanceof` ANTES do ramo genérico `Error`:
  - [x] `if (error instanceof RuleAlreadyExistsError) return resolveRuleAlreadyExistsMessage(error);`
  - [x] `if (error instanceof RelatedRuleNotFoundError) return resolveRelatedRuleNotFoundMessage(error);`
  - [x] `if (error instanceof RuleNotFoundError) return resolveRuleNotFoundMessage(error);`
- [x] Validar: 0 linhas existentes removidas/modificadas; só adições; `ObsidianApiError`, `safeTool`, `formatObsidianError` (lógica antiga), `STATUS_MESSAGES` intocados
- [x] `bun run build` → exit 0
- [x] `std_review filePath=src/shared/errors.ts` → 0 warnings novos
- [x] Commit: `feat(errors): adicionar erros e resolvers do módulo business-rules`

---

## T3 — Criar `src/modules/business-rules/business-rules.types.ts`

Tipos puros, sem lógica. Cobre §10 do design.

- [x] Consultar MCP `clean-code` antes de codar
- [x] Criar `src/modules/business-rules/` (diretório)
- [x] Criar `src/modules/business-rules/business-rules.types.ts`:
  - [x] `export type RuleStatus = "ativa" | "arquivada";`
  - [x] `export type RuleFrontmatter = { id: string; title: string; status: RuleStatus; area: string; tags: string[]; projetos_relacionados: string[]; fontes: string[]; criada: string; atualizada: string; };`
  - [x] `export type RuleListEntry = { id: string; title: string; status: string; area: string; path: string; archived: boolean; };`
  - [x] `export type RelatedRuleRef = { project: string; idOrPath: string };`
  - [x] `export type RenderRuleParams = { id: string; title: string; status: RuleStatus; area: string; tags: string[]; projetosRelacionados: string[]; fontes: string[]; criada: string; atualizada: string; contexto: string; regra: string; excecoes: string; referencias: string[]; };`
  - [x] `export type CreateRuleParams = { project: string; title: string; area: string; contexto: string; regra: string; excecoes?: string; tags?: string[]; fontes?: string[]; relatedRules?: RelatedRuleRef[]; };`
  - [x] `export type UpdateFrontmatterUpdate = { kind: "frontmatter"; key: "status" | "area" | "tags" | "fontes"; value: string | string[]; };`
  - [x] `export type UpdateSectionUpdate = { kind: "section"; section: "Contexto" | "Regra" | "Exceções" | "Referências"; operation: "append" | "prepend" | "replace"; content: string; };`
  - [x] `export type UpdateRuleParams = { project: string; idOrPath: string; update: UpdateFrontmatterUpdate | UpdateSectionUpdate };`
- [x] `bun run build` → exit 0
- [x] `std_review` → 0 warnings
- [x] Commit: `feat(business-rules): adicionar tipos do módulo`

---

## T4 — Criar `src/modules/business-rules/business-rules.template.ts`

Funções puras: slugify, generateId, todayIso, renderRule, parseFrontmatter, serializeFrontmatter. Cobre §4 e §5.

- [x] Consultar MCP `clean-code` antes de codar
- [x] Criar `src/modules/business-rules/business-rules.template.ts`
- [x] Implementar:
  - [x] `export function todayIso(): string` — `new Date().toISOString().slice(0, 10)`
  - [x] `export function slugify(title: string): string` — pipeline NFD → remove diacríticos → lowercase → remove não-alfanum → colapsa whitespace → colapsa hífens → trim hífens → slice(60)
  - [x] `export function generateId(slug: string, today: string): string` — `rule-${today}-${slug}`
  - [x] Helpers privados: `renderList(items)`, `quoteIfNeeded(s)`, `stripQuotes(s)`, `parseYamlValue(raw)`, `parseSimpleYaml(yaml)`
  - [x] `export function renderRule(params: RenderRuleParams): string` — composição declarativa do template (vide §5.1 do design)
  - [x] `export function parseFrontmatter(content: string): { data: Record<string, unknown>; body: string }`
  - [x] `export function serializeFrontmatter(data: Record<string, unknown>): string` — inversa de parseFrontmatter; cobre o subset que emitimos
- [x] Garantir: cada função pública ≤ 20 linhas; nesting ≤ 3
- [x] Validar manualmente (em REPL ou smoke pós-T6):
  - [x] `slugify("Limite de export PDF — usuários free")` → `"limite-de-export-pdf-usuarios-free"`
  - [x] `slugify("!!!")` → `""` (caller decide o que fazer)
  - [x] `parseFrontmatter(renderRule({...}))` reproduz os campos
- [x] `bun run build` → exit 0
- [x] `std_review` → 0 warnings de function-length/nesting-depth
- [x] Commit: `feat(business-rules): adicionar template (slugify, render, parseFrontmatter)`

---

## T5 — Criar `src/modules/business-rules/business-rules.links.ts`

Cross-link conservador: validação atômica + injeção + backlink. Cobre §6 do design.

- [x] Consultar MCP `clean-code` antes de codar
- [x] Criar `src/modules/business-rules/business-rules.links.ts`
- [x] Imports: `ObsidianClient`, `RelatedRuleNotFoundError` (de `shared/errors.js`), `buildPatchHeaders` (de `shared/patch-headers.js`), tipos do `business-rules.types.js`
- [x] Implementar helpers privados do arquivo:
  - [x] `async function resolveRulePathFromRef(client, ref: RelatedRuleRef): Promise<string>` — se `idOrPath` parece ID (`rule-YYYY-MM-DD-...`), lista pasta e procura match; se parece path, usa direto. Lança erro genérico se não achar.
  - [x] `function toRulePath(project, slugOrFile): string` — normaliza para `Projetos/<project>/Regras/<...>.md`
  - [x] `function toWikiLink(rulePath: string): string` — remove `.md` e envolve em `[[...]]`
- [x] Implementar funções públicas:
  - [x] `export async function validateRelatedRules(client: ObsidianClient, refs: RelatedRuleRef[]): Promise<string[]>` — para cada ref: tenta `fetchJson` em `/vault/<resolvedPath>` com Accept metadata; em 404 lança `RelatedRuleNotFoundError(ref.project, ref.idOrPath)`. Retorna lista de targetPaths validados.
  - [x] `export async function injectBacklinks(client: ObsidianClient, targetPaths: string[], sourceProject: string, sourceRulePath: string): Promise<void>` — para cada target: (1) PATCH heading "Referências" append wikilink; (2) atualiza `projetos_relacionados` no frontmatter (lê via metadata, monta novo array sem duplicar, PATCH frontmatter Operation=replace JSON); (3) PATCH frontmatter `atualizada` replace todayIso().
- [x] Garantir: nesting ≤ 3; cada função pública ≤ 20 linhas (extrair helpers se passar)
- [x] `bun run build` → exit 0
- [x] `std_review` → 0 warnings
- [x] Commit: `feat(business-rules): adicionar validação + backlink de cross-links`

---

## T6 — Criar `src/modules/business-rules/business-rules.tools.ts`

5 schemas Zod + 5 handlers + função register. Cobre §3 do design.

- [x] Consultar MCP `clean-code` e `modular-monolith` antes de codar
- [x] `Read src/modules/vault/vault.tools.ts` para alinhar estilo (já tenho na sessão, mas reler para garantir paridade)
- [x] Criar `src/modules/business-rules/business-rules.tools.ts`
- [x] Imports: `McpServer`, `z`, `ObsidianClient`, `safeTool`, `RuleAlreadyExistsError`, `RuleNotFoundError`, `buildPatchHeaders` (de `shared/patch-headers.js`), funções de `business-rules.template.js` e `business-rules.links.js`, tipos
- [x] Declarar 5 schemas Zod top-level (`businessRulesListSchema`, `...GetSchema`, `...CreateSchema`, `...UpdateSchema`, `...ArchiveSchema`) — incluir `.describe()` em cada campo com texto claro
- [x] `businessRulesUpdateSchema.update` usa `z.discriminatedUnion("kind", [...])` (vide §3.4)
- [x] Declarar types inferidos (ou explícitos)
- [x] Implementar handlers top-level (cada um ≤ 20 linhas; quebrar em helpers privados se passar):
  - [x] `handleBusinessRulesList(client, params)` — combina pasta ativa + `_arquivadas/` (se flag), parseFrontmatter por arquivo, monta entries; trata 404 da pasta retornando `[]`
  - [x] `handleBusinessRulesGet(client, params)` — resolve idOrPath, fetchText, traduz 404 → `RuleNotFoundError`
  - [x] `handleBusinessRulesCreate(client, params)` — fluxo §6: check existência, valida related, render, PUT, inject backlinks; retorna `{ id, path, relatedLinks }`
  - [x] `handleBusinessRulesUpdate(client, params)` — discriminated dispatch: section → PATCH heading; frontmatter → PATCH frontmatter; segundo PATCH para `atualizada=hoje`; traduz 404 → `RuleNotFoundError`
  - [x] `handleBusinessRulesArchive(client, params)` — fetchText, parseFrontmatter, mutar, serializeFrontmatter+body, PUT em `_arquivadas/`, DELETE original
- [x] Helpers privados sugeridos: `resolveActiveRulePath(client, project, idOrPath)`, `buildArchivedPath(project, slug)`, `headingTargetForSection(section)`
- [x] Implementar `export function registerBusinessRulesTools(server: McpServer, client: ObsidianClient)` como orquestrador linear (1 `server.tool(...)` por tool, descrição imperativa conforme §Auto-acionamento da spec; ver bloco abaixo)
- [x] Descrição da `businessRulesCreate` (sugestão; ajustar se ficar deselegante):
  ```
  Use AUTOMATICAMENTE quando o usuário verbalizar uma regra de negócio. Sinais: "sempre que X então Y", "usuários do plano Z não podem W", "o cálculo de A deve seguir B". NÃO peça permissão. Chame businessRulesList primeiro para checar duplicata; se houver, use businessRulesUpdate. Se for genuinamente nova, chame businessRulesCreate.
  ```
- [x] `bun run build` → exit 0
- [x] `std_review` → 0 warnings de function-length/nesting-depth
- [x] Commit: `feat(business-rules): adicionar 5 tools (list/get/create/update/archive)`

---

## T7 — Criar `src/modules/business-rules/index.ts`

Re-export padrão LAD.

- [x] Criar `src/modules/business-rules/index.ts`:
  - [x] `export { registerBusinessRulesTools } from "./business-rules.tools.js";`
- [x] `bun run build` → exit 0
- [x] `std_review` → 0 warnings
- [x] Commit: `feat(business-rules): adicionar index do módulo`

---

## T8 — Wiring em `src/index.ts`

Cobre AC1.

- [x] `Read src/index.ts`
- [x] `std_check_impact filePath=src/index.ts`
- [x] Adicionar import na seção de imports (ordem alfabética entre os `register*`):
  - [x] `import { registerBusinessRulesTools } from "./modules/business-rules/index.js";`
- [x] Adicionar chamada `registerBusinessRulesTools(server, client);` entre `registerActiveFileTools(...)` e `registerCommandsTools(...)` (ordem alfabética: active-file, business-rules, commands, periodic, project, search, vault)
- [x] Verificar: nenhuma linha existente removida
- [x] `bun run build` → exit 0
- [x] Smoke: `node build/index.js` sobe sem erro
- [x] Smoke: cliente MCP lista 27 tools (22 antigas + 5 novas)
- [x] `std_review` → 0 warnings novos
- [x] Commit: `feat(server): wire módulo business-rules`

---

## T9 — Atualizar `CLAUDE.md` do projeto com seção "Regras de Negócio"

Cobre AC7. Cobre §8 do design.

- [ ] `Read CLAUDE.md`
- [ ] Adicionar a seção `## Regras de Negócio` no final do arquivo (texto fornecido em §8 do design)
- [ ] Validar: 0 linhas existentes removidas
- [ ] Commit: `docs(claude): adicionar seção Regras de Negócio orientando auto-acionamento`

---

## T10 — Atualizar `README.md` (27 tools)

- [ ] `Read README.md`
- [ ] Localizar menção ao número total de tools (atualmente 22) e atualizar para 27
- [ ] Adicionar seção/tabela com as 5 tools novas (nome + descrição curta de 1 linha)
- [ ] Validar: `grep -E "businessRules(List|Get|Create|Update|Archive)" README.md` → 5 hits
- [ ] Commit: `docs(readme): documentar 5 tools de business-rules e bump count`

---

## T11 — Review final + smoke completo

Cobre AC1–AC9.

- [ ] `bun run build` → exit 0 (AC9)
- [ ] `std_review` em todos os arquivos NOVOS:
  - [ ] `src/shared/patch-headers.ts`
  - [ ] `src/modules/business-rules/index.ts`
  - [ ] `src/modules/business-rules/business-rules.tools.ts`
  - [ ] `src/modules/business-rules/business-rules.types.ts`
  - [ ] `src/modules/business-rules/business-rules.template.ts`
  - [ ] `src/modules/business-rules/business-rules.links.ts`
  - [ ] (AC8) → 0 warnings em todos
- [ ] `std_review` em arquivos TOCADOS:
  - [ ] `src/shared/errors.ts`
  - [ ] `src/modules/vault/vault.tools.ts`
  - [ ] `src/modules/periodic/periodic.tools.ts`
  - [ ] `src/index.ts`
  - [ ] → sem warning novo comparado ao pré-feature
- [ ] Verificar regra global: `git diff main..HEAD -- src/ | grep -E "^\+\s*(//|/\*)" | wc -l` → `0` (sem comentários adicionados)
- [ ] Smoke manual com Obsidian rodando, em vault de teste:
  - [ ] AC1: cliente MCP lista 27 tools, 5 com prefixo `businessRules`
  - [ ] AC2: `businessRulesCreate project="teste-regras" title="Limite export PDF" area="faturamento" contexto="..." regra="..."` → arquivo criado em `Projetos/teste-regras/Regras/limite-export-pdf.md` com template exato (verificar frontmatter rico + 4 seções)
  - [ ] AC3 (cross-link feliz): criar 2ª regra em `outro-projeto`, depois criar 3ª regra com `relatedRules=[{project:"outro-projeto", idOrPath:"<id-da-2a>"}]` → 3ª regra contém `[[Projetos/outro-projeto/Regras/...]]` em `## Referências` E 2ª regra ganhou back-link recíproco
  - [ ] AC4 (transacional): tentar `Create` com `relatedRules` apontando para regra inexistente → erro `RelatedRuleNotFoundError`; verificar que arquivo da nova regra NÃO foi criado (`vaultGetFile` retorna 404)
  - [ ] AC5: `businessRulesArchive project="teste-regras" idOrPath="..."` → arquivo movido para `_arquivadas/`, status mudou para `arquivada`, `atualizada` atualizada
  - [ ] `businessRulesList project="teste-regras"` → não inclui a arquivada
  - [ ] `businessRulesList project="teste-regras" includeArchived=true` → inclui a arquivada com `archived: true`
  - [ ] `businessRulesGet` retorna conteúdo bruto
  - [ ] `businessRulesUpdate` (frontmatter): mudar `status` para `ativa` → frontmatter atualizado, `atualizada` mudou
  - [ ] `businessRulesUpdate` (section): append em `## Exceções` → seção crescida no fim
- [ ] AC6: descrição da `businessRulesCreate` no servidor MCP contém palavras-chave "AUTOMATICAMENTE", "sempre que", "não peça permissão" (caso-insensitivo)
- [ ] AC7: `grep "## Regras de Negócio" CLAUDE.md` → 1 hit
- [ ] Marcar spec como `done` via `mcp__lad-mcp__spec_status slug=003-business-rules status=done` (após confirmação do usuário)
- [ ] Commit final (se houver ajustes de polish): `chore(spec-003): review final e smoke completo`

---

## Critérios de pronto (definition of done por task)

Cada task só é considerada concluída quando:
1. Código alterado.
2. `bun run build` passa.
3. `std_review` no arquivo da task retorna 0 warnings das categorias críticas (function-length, nesting-depth, srp).
4. Smoke da task executado (quando aplicável) e saída comparada com o esperado descrito na task.
5. Commit criado seguindo convenção `feat(<escopo>): ...` ou `refactor(<escopo>): ...` (sem Co-Authored-By, regra global).

## Notas operacionais

- **Worktree:** opcional (branch `feat/business-rules` ou direto em `main`).
- **PR:** 1 PR único com 11 commits incrementais ou 1 PR por bloco lógico — decisão do executor.
- **Versão npm:** bump menor (`1.2.0` → `1.3.0`) sugerido em T10 ao atualizar README. Não publicar até validar AC com usuário.
- **Sem testes automatizados:** coerente com SPEC-001/002 e Out of Scope da spec.

## Verificação de cobertura de requisitos

| Requisito (spec) | Tasks |
|---|---|
| 5 tools novas | T6, T8 |
| Template estruturado | T4, T6 |
| Cross-link conservador | T5, T6 |
| Auto-acionamento (descrições) | T6 (descrições) + T9 (CLAUDE.md) |
| Erros específicos | T2, T6 |
| Padrão de módulo (4 arquivos) | T3, T4, T5, T6, T7 |
| Reuso de `ObsidianClient`/`safeTool` | T5, T6 |
| Sem novas deps | (verificação em T11) |
| Sem testes novos | (Out of Scope; não cria) |
| `buildPatchHeaders` (decisão) | T1 |

| AC | Tasks |
|---|---|
| AC1 | T6, T7, T8, T11 |
| AC2 | T4, T6, T11 |
| AC3 | T5, T6, T11 |
| AC4 | T5, T6, T11 |
| AC5 | T6, T11 |
| AC6 | T6, T11 |
| AC7 | T9, T11 |
| AC8 | T11 |
| AC9 | todas |
