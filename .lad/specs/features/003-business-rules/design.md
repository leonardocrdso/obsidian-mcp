# Design — SPEC-003: Business Rules Module

**Status:** ready
**Spec:** `.lad/specs/features/003-business-rules/spec.md`

## 1. Arquitetura do módulo

### 1.1 Árvore de arquivos

```
src/
  modules/
    business-rules/
      index.ts                     # re-export: registerBusinessRulesTools
      business-rules.tools.ts      # 5 schemas Zod + 5 handlers + register
      business-rules.types.ts      # tipos puros (Rule, RuleFrontmatter, RuleListEntry, RelatedRuleRef, ...)
      business-rules.template.ts   # slugify, generateId, render, parseFrontmatter, today, updateFrontmatterDate
      business-rules.links.ts      # validateRelatedRules, injectReferencesSection, backlinkInTarget
  shared/
    patch-headers.ts               # NOVO: helper compartilhado (decisão §2)
    obsidian-client.ts             # intocado
    errors.ts                      # +3 erros + 3 resolvers (aditivo)
    config.ts                      # intocado
    setup.ts                       # intocado
    types.ts                       # intocado
  modules/vault/vault.tools.ts     # import alterado: buildPatchHeaders vem de shared/patch-headers
  modules/periodic/periodic.tools.ts # idem
  index.ts                         # + import + chamada registerBusinessRulesTools
CLAUDE.md                          # + seção "## Regras de Negócio"
README.md                          # + linha "27 tools"
```

### 1.2 Fluxo das 5 tools (alto nível)

```
businessRulesList(project, includeArchived?)
  → ObsidianClient.fetchJson("/vault/Projetos/<project>/Regras/")
  → (opcional) ObsidianClient.fetchJson("/vault/Projetos/<project>/Regras/_arquivadas/")
  → para cada .md: fetchJson com Accept: application/vnd.olrapi.note+json
  → extrai frontmatter → mapeia para RuleListEntry { id, title, status, area, path }
  → retorna JSON

businessRulesGet(project, idOrPath)
  → resolveRulePath(client, project, idOrPath)  (lista + match por id, ou usa path direto)
  → fetchText → retorna markdown bruto

businessRulesCreate(project, title, area, contexto, regra, excecoes?, tags?, fontes?, relatedRules?)
  → generateId + slugify
  → newPath = "Projetos/<project>/Regras/<slug>.md"
  → vaultGetMetadata(newPath) → se 200 → RuleAlreadyExistsError
  → se relatedRules.length > 0:
      → validateRelatedRules(client, relatedRules)
        → para cada: vaultGetMetadata(targetPath); 404 → RelatedRuleNotFoundError
      → todos OK antes de prosseguir (transacional)
  → render(template, params) → body
  → fetchVoid PUT /vault/<newPath> com body
  → se relatedRules: para cada alvo
      → backlinkInTarget(client, target, sourceWikiLink)
        → PATCH heading "Referências" operation=append (createTargetIfMissing=true)
        → PATCH frontmatter projetos_relacionados append project
      → atualiza atualizada=hoje no alvo
  → retorna { id, path: newPath, relatedLinks: string[] }

businessRulesUpdate(project, idOrPath, update)
  → resolveRulePath → targetPath
  → discriminated union:
      kind="frontmatter": PATCH com Target-Type=frontmatter, Target=key, Operation=replace
      kind="section":     PATCH com Target-Type=heading, Target=section, Operation=op
  → segundo PATCH: frontmatter atualizada=hoje (Operation=replace)
  → retorna { path, updated: true }

businessRulesArchive(project, idOrPath)
  → resolveRulePath → originalPath
  → fetchText → conteúdo atual
  → updateFrontmatterDate(content, "status", "arquivada") + atualizada=hoje
  → archivedPath = "Projetos/<project>/Regras/_arquivadas/<slug>.md"
  → PUT /vault/<archivedPath>  (cria cópia já atualizada)
  → DELETE /vault/<originalPath>
  → retorna { archivedPath }
```

## 2. Decisão: `buildPatchHeaders`

**Decisão:** extrair para `src/shared/patch-headers.ts` ANTES de implementar `business-rules`.

**Justificativa:**

1. Hoje há 2 cópias byte-a-byte (vault.tools.ts:81-96, periodic.tools.ts:59-74). `business-rules.tools.ts` precisará da mesma lógica para `Update` (PATCH com Target-Type heading/frontmatter), o que criaria a 3ª cópia.
2. Princípio DRY do MCP `clean-code`: ≥3 cópias = obrigação de extrair.
3. Princípio SRP do MCP `modular-monolith`: `vault.tools.ts` e `periodic.tools.ts` têm "tools de Vault/Periodic" como responsabilidade — montar headers HTTP não pertence ali.
4. Refactor preventivo é menor agora (1 task atômica) do que depois (3 consumidores espalhados, mais risco de divergência).

**Alternativa considerada:** manter duplicação até business-rules introduzir a 3ª cópia, então extrair. Rejeitada — força refactor pós-implementação com escopo maior e tira aproveitamento de revisão única.

**Forma do helper extraído:**

```ts
// src/shared/patch-headers.ts
export type PatchHeaderParams = {
  operation: string;
  targetType: string;
  target: string;
  targetDelimiter?: string;
  trimTargetWhitespace?: boolean;
  createTargetIfMissing?: boolean;
};

export function buildPatchHeaders(params: PatchHeaderParams): Record<string, string> { ... }
```

Comportamento idêntico ao atual (encodeURIComponent no Target, headers opcionais como String). Consumidores: `vault.tools.ts`, `periodic.tools.ts`, `business-rules.tools.ts` (via `business-rules.links.ts`).

## 3. Contrato das tools

Todos os handlers retornam `{ content: [{ type: "text", text: <JSON.stringify(payload, null, 2)> | <mensagem> }] }`, padrão dos demais módulos. Erros vão por `safeTool` → `formatObsidianError`.

### 3.1 `businessRulesList`

**Input (Zod):**
```ts
{
  project: z.string().describe("Slug do projeto sob Projetos/"),
  includeArchived: z.boolean().optional().describe("Incluir _arquivadas/ (default false)"),
}
```

**Output:** `RuleListEntry[]` serializado:
```ts
type RuleListEntry = {
  id: string;
  title: string;
  status: string;
  area: string;
  path: string;
  archived: boolean;
};
```

**Erros possíveis:**
- `ObsidianApiError(404)` natural se pasta não existir → repassado.
- Frontmatter ausente/malformado em uma regra → entrada é incluída com `id="", title="<path>", status="", area=""` (não derruba a listagem).

### 3.2 `businessRulesGet`

**Input:** `{ project: string; idOrPath: string }`.

**Output:** texto markdown bruto.

**Erros:**
- `RuleNotFoundError` se `idOrPath` é ID e nenhum match na listagem.
- `ObsidianApiError(404)` se path direto não existe → convertido para `RuleNotFoundError` no handler.

### 3.3 `businessRulesCreate`

**Input:**
```ts
{
  project: z.string(),
  title: z.string(),
  area: z.string(),
  contexto: z.string(),
  regra: z.string(),
  excecoes: z.string().optional(),
  tags: z.array(z.string()).optional(),
  fontes: z.array(z.string()).optional(),
  relatedRules: z.array(z.object({
    project: z.string(),
    idOrPath: z.string(),
  })).optional(),
}
```

**Output:** `{ id: string; path: string; relatedLinks: string[] }`.

**Erros:**
- `RuleAlreadyExistsError(existingPath)` se path já existe.
- `RelatedRuleNotFoundError(project, idOrPath)` se qualquer `relatedRules[i]` não existir (validação atômica ANTES de qualquer write).
- `ObsidianApiError` propagado.

### 3.4 `businessRulesUpdate`

**Input (discriminated union via Zod):**
```ts
{
  project: z.string(),
  idOrPath: z.string(),
  update: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("frontmatter"),
      key: z.enum(["status", "area", "tags", "fontes"]),
      value: z.union([z.string(), z.array(z.string())]),
    }),
    z.object({
      kind: z.literal("section"),
      section: z.enum(["Contexto", "Regra", "Exceções", "Referências"]),
      operation: z.enum(["append", "prepend", "replace"]),
      content: z.string(),
    }),
  ]),
}
```

**Output:** `{ path: string; updated: true }`.

**Erros:**
- `RuleNotFoundError`.
- `ObsidianApiError(400)` se Target inválido → repassado.

### 3.5 `businessRulesArchive`

**Input:** `{ project: string; idOrPath: string }`.

**Output:** `{ archivedPath: string }`.

**Erros:**
- `RuleNotFoundError`.
- Se PUT na cópia falhar, DELETE não acontece. Se DELETE falhar APÓS PUT, fica copia órfã — esse caso é considerado aceitável (estado final = regra duplicada, sem perda de dados; usuário pode limpar manualmente). Documentado em "Riscos" §9.

## 4. Algoritmos: `slugify` e `generateId`

### 4.1 `slugify(title: string): string`

```ts
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
```

Passos:
1. NFD + remoção de marcas de combinação → tira acentos (`á` → `a`).
2. lowercase.
3. Remove tudo que não é `a-z0-9` espaço ou hífen.
4. Trim + colapsa whitespace em `-`.
5. Colapsa hífens duplicados.
6. Limita a 60 chars para evitar paths gigantes.

**Casos de borda:**
- Título vazio após normalização → tool falha com erro de validação antes (Zod `.min(1)` no `title`).
- Título só com símbolos (`"!!!"`) → resulta em string vazia → erro `InvalidTitleError` lançado no handler. (Decisão `[default]`: usar erro genérico `Error("Título inválido após normalização")` capturado por `formatObsidianError`.)

### 4.2 `generateId(slug: string, today: string): string`

```ts
export function generateId(slug: string, today: string): string {
  return `rule-${today}-${slug}`;
}
```

`today` = `YYYY-MM-DD` em UTC para determinismo:

```ts
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
```

## 5. Render e parse de frontmatter

### 5.1 Render do template

Função `renderRule(params)` recebe `{ id, title, area, status, tags, projetosRelacionados, fontes, criada, atualizada, contexto, regra, excecoes, referencias }` e devolve string.

```ts
export function renderRule(params: RenderParams): string {
  const fm = [
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
  const sections = [
    "## Contexto",
    params.contexto,
    "",
    "## Regra",
    params.regra,
    "",
    "## Exceções",
    params.excecoes || "Nenhuma identificada.",
    "",
    "## Referências",
    params.referencias.length > 0 ? params.referencias.map((r) => `- ${r}`).join("\n") : "",
  ].join("\n");
  return fm + sections + "\n";
}

function renderList(items: string[] | undefined): string {
  if (!items || items.length === 0) return "[]";
  return `[${items.map((s) => quoteIfNeeded(s)).join(", ")}]`;
}

function quoteIfNeeded(s: string): string {
  if (/[,:\[\]'"]/.test(s)) return `"${s.replace(/"/g, '\\"')}"`;
  return s;
}
```

### 5.2 Parser de frontmatter (caseiro, sem dependência)

```ts
export function parseFrontmatter(content: string): { data: Record<string, unknown>; body: string } {
  if (!content.startsWith("---\n")) return { data: {}, body: content };
  const end = content.indexOf("\n---", 4);
  if (end === -1) return { data: {}, body: content };
  const yaml = content.slice(4, end);
  const body = content.slice(end + 4).replace(/^\n/, "");
  return { data: parseSimpleYaml(yaml), body };
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

function parseYamlValue(raw: string): unknown {
  if (raw === "" || raw === "[]") return raw === "[]" ? [] : "";
  if (raw.startsWith("[") && raw.endsWith("]")) {
    return raw.slice(1, -1).split(",").map((s) => stripQuotes(s.trim())).filter((s) => s.length > 0);
  }
  return stripQuotes(raw);
}
```

**Decisão `[default]`:** parser caseiro em vez de `gray-matter`. Justificativa: spec proíbe novas deps; nosso template é controlado (sempre gerado por `renderRule`) — não precisamos lidar com YAML arbitrário; o parser cobre os campos que de fato emitimos. Limitação aceita: não suporta YAML aninhado, multi-linha ou referências — não usamos nenhum desses.

### 5.3 Atualização de campo no frontmatter sem reescrever arquivo

Para `Update` e `Archive` que precisam mexer no frontmatter, usamos a API PATCH do Obsidian REST com `Target-Type: frontmatter` e `Operation: replace`. NÃO reescrevemos o frontmatter inteiro localmente — delegamos ao Obsidian. Isso evita race condition se o usuário editou no app.

Exceção: `Archive` precisa ler o arquivo (para gerar a cópia em `_arquivadas/`) e então emitir 2 PATCHes no frontmatter antes do PUT da cópia. Como a cópia é um novo arquivo (PUT), basta gerar o conteúdo correto via reescrita local do frontmatter. Fluxo detalhado em §7.

## 6. Fluxo transacional de `Create` com `relatedRules`

**Princípio:** validar tudo antes de escrever qualquer coisa.

```
1. Computar newPath.
2. HEAD/GET metadata em newPath → se existe → throw RuleAlreadyExistsError(newPath). EARLY RETURN.
3. Para cada item em relatedRules:
     a. Resolver targetPath via listagem da pasta do projeto-alvo (se idOrPath é ID).
     b. vaultGetMetadata(targetPath).
     c. Se 404 → throw RelatedRuleNotFoundError(item.project, item.idOrPath). EARLY RETURN.
     d. Acumular targetPath em validatedTargets[].
4. Renderizar conteúdo com referências [[<targetPath sem .md>]] já preenchidas.
5. PUT /vault/<newPath> com body. (Ponto de não-retorno — após isso, falhas em 6 deixam estado parcial; documentado.)
6. Para cada targetPath em validatedTargets:
     a. PATCH heading "Referências" append `[[Projetos/<thisProject>/Regras/<thisSlug>]]` (createTargetIfMissing=true).
     b. PATCH frontmatter `projetos_relacionados` append `<thisProject>` (usar Operation=replace lendo valor atual primeiro — ver detalhe abaixo).
     c. PATCH frontmatter `atualizada` replace = today.
7. Retornar { id, path: newPath, relatedLinks: validatedTargets.map(toWikiLink) }.
```

**Detalhe sobre `projetos_relacionados` (frontmatter):** o Local REST API não tem operação nativa "append a um array em frontmatter". Estratégia:
1. `vaultGetMetadata(targetPath)` → lê frontmatter atual.
2. Compõe novo array: `[...current, thisProject]` (sem duplicar).
3. PATCH frontmatter `projetos_relacionados` Operation=replace com o novo array serializado como JSON (Local REST API aceita JSON literal em frontmatter via Target-Type=frontmatter).

Esse padrão fica encapsulado em `business-rules.links.ts`.

**Risco aceito:** se passo 6 falhar parcialmente (ex.: 2 alvos válidos, mas o 2º PATCH explode), a regra nova já foi criada e tem o wiki-link no body, mas o back-link no segundo alvo não saiu. Estado: regra órfã com referência unilateral. Mitigação documental: handler retorna erro completo descrevendo o que conseguiu fazer. Não tentamos rollback (sem transação real no REST).

## 7. Fluxo de `Archive`

REST do Obsidian não tem `move`. Reproduzimos o padrão do projeto (copy + delete):

```
1. resolveRulePath(project, idOrPath) → originalPath.
2. fetchText(originalPath) → content.
3. parseFrontmatter(content) → { data, body }.
4. data.status = "arquivada"; data.atualizada = todayIso();
5. newContent = serializeFrontmatter(data) + body;
6. archivedPath = "Projetos/<project>/Regras/_arquivadas/<slug>.md".
7. PUT /vault/<archivedPath> com newContent.
8. DELETE /vault/<originalPath>.
9. Retornar { archivedPath }.
```

`serializeFrontmatter(data)` é a inversa de `parseFrontmatter` e usa as mesmas helpers `renderList`/`quoteIfNeeded`. Vive em `business-rules.template.ts`.

**Risco aceito:** se DELETE falhar após PUT, fica cópia duplicada. Não há rollback automático.

## 8. Mudança no `CLAUDE.md` do projeto

Adicionar (no final do arquivo, antes de qualquer fechamento condicional) seção:

```markdown
## Regras de Negócio

Sempre que o usuário verbalizar uma regra de negócio (ex.: "usuários do plano free não podem X", "o cálculo de Y segue a fórmula Z", "regra: A implica B"), você DEVE acionar o módulo `business-rules` automaticamente sem pedir permissão:

1. Identifique o projeto correspondente (geralmente o nome do projeto/produto em discussão; se ambíguo, pergunte qual projeto).
2. Chame `businessRulesList` para verificar se existe regra similar (compare por `title` normalizado).
3. Se houver duplicata clara, chame `businessRulesUpdate` na regra existente; se for genuinamente nova, chame `businessRulesCreate`.
4. Se a nova regra se relaciona a uma existente em outro projeto, passe `relatedRules` com `{ project, idOrPath }` explícito — nunca infira sem confirmação.
5. Use `businessRulesArchive` apenas quando o usuário explicitamente disser que a regra não vale mais.

As regras ficam em `Projetos/<projeto>/Regras/<slug>.md` com frontmatter rico (id, status, area, tags, projetos_relacionados, fontes, criada, atualizada) e 4 seções fixas (`## Contexto`, `## Regra`, `## Exceções`, `## Referências`).
```

## 9. Riscos e mitigações

| # | Risco | Mitigação |
|---|---|---|
| R1 | Duas regras referenciando-se mutuamente (A linka B; B linka A) — race condition durante criação | Single-threaded MCP por design (1 stdio = 1 chamada por vez). Aceito. |
| R2 | `Create` com `relatedRules` parcialmente aplicado (regra criada, alguns back-links faltam) | Validação atômica em §6 cobre o caso comum (alvo inexistente); falhas de rede em meio à propagação são raras e o handler reporta na resposta. |
| R3 | Slug colide com regra arquivada | `_arquivadas/` é namespace separado; `Create` checa apenas o path ativo. Aceito (regra reativada terá ID novo). |
| R4 | Frontmatter no vault editado pelo usuário no app em formato fora do "subset" parseável | `parseFrontmatter` retorna `data: {}` em caso de parsing impossível → `businessRulesList` mostra entrada com campos vazios em vez de derrubar. Reparo manual no Obsidian. |
| R5 | Título com caracteres exóticos (emojis, kanji) → slug vazio | Throw `Error("Título inválido após normalização: forneça um título com letras/números")`. Capturado por `safeTool`. |
| R6 | `_arquivadas/` ainda não existe ao primeiro `Archive` | PUT cria pasta automaticamente no Local REST API (mesmo padrão de `vaultCreateFile`). |
| R7 | `Archive` deixa cópia órfã se DELETE falhar | Documentado. Sem rollback. |

## 10. Nomes e tipos consolidados

```ts
// business-rules.types.ts
export type RuleStatus = "ativa" | "arquivada";

export type RuleFrontmatter = {
  id: string;
  title: string;
  status: RuleStatus;
  area: string;
  tags: string[];
  projetos_relacionados: string[];
  fontes: string[];
  criada: string;
  atualizada: string;
};

export type RuleListEntry = {
  id: string;
  title: string;
  status: string;
  area: string;
  path: string;
  archived: boolean;
};

export type RelatedRuleRef = { project: string; idOrPath: string };

export type CreateRuleParams = { ... };  // espelha schema Zod
export type UpdateRuleParams = { ... };
```

## 11. Decisões arquiteturais consolidadas

- **[default]** Parser de frontmatter caseiro (sem `gray-matter`) — justificado em §5.2.
- **Extrair `buildPatchHeaders`** para `src/shared/patch-headers.ts` antes da implementação do módulo — justificado em §2.
- **Validação transacional** em `Create` — todas as `relatedRules` validadas ANTES de qualquer write — §6.
- **Sem rollback** em falhas pós-PUT — aceito, documentado em §9.
- **[default]** ID determinístico `rule-<YYYY-MM-DD>-<slug>` (mesmo dia + mesmo slug = mesmo ID) — `Create` rejeita duplicata via check de path.
- **Single-thread MCP** assumido — sem locking.
- **[default]** Slug limitado a 60 chars para evitar paths longos.
- **Cross-link conservador** (só com `relatedRules` explícito) — herdado da spec, reforçado em §6.

## 12. Cobertura de Acceptance Criteria

| AC | Onde está coberto |
|---|---|
| AC1 (5 tools registradas) | §1.1 wiring + §3 contratos |
| AC2 (template exato) | §5.1 renderRule + §10 RuleFrontmatter |
| AC3 (link + backlink) | §6 passos 4 + 6a |
| AC4 (transacional) | §6 passos 2–3 (early return antes de qualquer write) |
| AC5 (Archive copy+delete) | §7 |
| AC6 (descrições imperativas) | §3 (descritores Zod) + tools.ts (corpo das `server.tool`) |
| AC7 (CLAUDE.md seção) | §8 |
| AC8 (`std_review` limpo) | implícito — tasks.md exige por arquivo |
| AC9 (`bun run build` passa) | implícito — tasks.md exige por task |
