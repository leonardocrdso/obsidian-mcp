# SPEC-003: Business Rules Module

**Status:** draft
**Created:** 2026-05-23
**Updated:** 2026-05-23

## Overview

### Contexto do produto

O `obsidian-mcp` hoje expõe ferramentas genéricas de vault (criar/ler/atualizar arquivos) mas não tem nenhuma abstração específica para **regras de negócio** descobertas durante conversas com usuários, discoveries e sessões de planejamento. Hoje, quando o usuário verbaliza uma regra ("usuários free não podem exportar PDF", "rate limit é 100 req/min por API key"), o Claude precisa:

1. Saber sozinho onde guardar (sem padrão);
2. Escolher formato ad-hoc (markdown solto, sem frontmatter);
3. Não tem como detectar duplicatas/atualizações de regras já existentes;
4. Não há vínculo entre regras que mencionam projetos diferentes.

O resultado é que regras se perdem entre conversas — o Claude esquece, o usuário re-verbaliza, e o vault não acumula conhecimento de forma queryable.

### Objetivo

Introduzir um módulo MCP novo `business-rules` que oferece CRUD especializado para regras de negócio, com:

- **Localização padronizada** no vault: `Projetos/<projeto>/Regras/<slug>.md`.
- **Template estruturado** (frontmatter rico + 4 seções fixas) que torna as regras queryables via dataview.
- **Cross-linking conservador** entre projetos quando o usuário aponta a regra-alvo explicitamente.
- **Auto-acionamento** pelo Claude via descrições imperativas das tools, sem necessidade de o usuário pedir "salva essa regra".

### Decisão arquitetural raiz: aditivo, não substitutivo

Esta spec **não toca** em:

- `src/shared/obsidian-client.ts` (REST client) — apenas consome.
- Demais módulos (`vault`, `search`, `periodic`, `commands`, `active-file`) — independentes.
- Contratos das tools existentes.

Toques permitidos:

- `src/index.ts` — wiring do novo módulo (linhas adicionadas).
- `CLAUDE.md` do projeto — nova seção "Regras de Negócio" instruindo o comportamento auto-acionável.

### Restrições herdadas

- Pacote npm publicado: tools existentes mantêm contrato byte-a-byte.
- Sem comentários no código (regra global CLAUDE.md).
- Consultar MCPs `clean code` e `modular-monolith` ao codar.
- Sem novos testes automatizados (projeto não tem suite hoje; coerente com SPEC-001/002).
- Reuso de `ObsidianClient`, `safeTool`, `buildPatchHeaders` existentes.
- Sem novas dependências (apenas `@modelcontextprotocol/sdk` e `zod` já presentes).

## Requirements

### Comportamento esperado

O servidor passa a expor **5 tools novas** sob o prefixo `businessRules*`:

#### 1. `businessRulesList`

**Parâmetros:**
- `project: string` — nome do projeto (slug da pasta em `Projetos/`).
- `includeArchived?: boolean` (default `false`).

**Comportamento:** lista arquivos `.md` em `Projetos/<project>/Regras/` (e `_arquivadas/` se `includeArchived`). Para cada regra, retorna `{ id, title, status, area, path }` extraído do frontmatter.

**Uso esperado pelo Claude:** chamada ANTES de `Create`/`Update` para detectar duplicata pelo título normalizado.

#### 2. `businessRulesGet`

**Parâmetros:**
- `project: string`.
- `idOrPath: string` — ID `rule-YYYY-MM-DD-<slug>` OU path relativo a `Projetos/<project>/Regras/`.

**Comportamento:** retorna conteúdo bruto da regra (markdown + frontmatter).

#### 3. `businessRulesCreate`

**Parâmetros:**
- `project: string`.
- `title: string`.
- `area: string`.
- `contexto: string` — preenche seção `## Contexto`.
- `regra: string` — preenche seção `## Regra`.
- `excecoes?: string` — preenche seção `## Exceções` (default: "Nenhuma identificada.").
- `tags?: string[]`.
- `fontes?: string[]` — origem da regra (ex: "discovery 2026-05-23 com Leonardo").
- `relatedRules?: Array<{ project: string; idOrPath: string }>` — cross-link explícito conservador.

**Comportamento:**
1. Gera `id` = `rule-<YYYY-MM-DD>-<slug-curto>` e `slug` = `kebab-case(removeAcentos(title))`.
2. Renderiza template (frontmatter rico + 4 seções).
3. Para cada item em `relatedRules`:
   - Valida que a regra-alvo existe (via `vaultGetMetadata`); se não existir, retorna erro `RelatedRuleNotFound` sem criar nada.
   - Insere `[[Projetos/<otherProject>/Regras/<slug-alvo>]]` na seção `## Referências` da nova regra.
   - Faz back-link: `PATCH append` na seção `## Referências` da regra-alvo com `[[Projetos/<thisProject>/Regras/<slug>]]`.
   - Adiciona ambos os projetos em `projetos_relacionados` (frontmatter, ambas as regras).
4. Cria arquivo via `PUT /vault/Projetos/<project>/Regras/<slug>.md`.
5. Retorna `{ id, path, relatedLinks: string[] }`.

**Falha se** já existir arquivo no mesmo path — retorna mensagem com path existente sugerindo `Update`.

#### 4. `businessRulesUpdate`

**Parâmetros:**
- `project: string`.
- `idOrPath: string`.
- `update: Frontmatter | Section`:
  - `{ kind: "frontmatter"; key: "status" | "area" | "tags" | "fontes"; value: string | string[] }`
  - `{ kind: "section"; section: "Contexto" | "Regra" | "Exceções" | "Referências"; operation: "append" | "prepend" | "replace"; content: string }`

**Comportamento:** usa `PATCH /vault/...` com `Target-Type: heading` (para seções) ou `frontmatter` (para campos). Atualiza `atualizada: YYYY-MM-DD` no frontmatter em qualquer mudança.

#### 5. `businessRulesArchive`

**Parâmetros:**
- `project: string`.
- `idOrPath: string`.

**Comportamento:**
1. Lê regra (`Get`).
2. Atualiza frontmatter: `status: arquivada`, `atualizada: <hoje>`.
3. Cria cópia em `Projetos/<project>/Regras/_arquivadas/<slug>.md` (via `vaultCreateFile`).
4. Deleta original (`vaultDeleteFile`).

Retorna `{ archivedPath }`.

### Template renderizado

```markdown
---
id: rule-2026-05-23-limite-export-pdf
title: Limite de export PDF para usuários free
status: ativa
area: faturamento
tags: [export, plano-free]
projetos_relacionados: [obsidian-mcp]
fontes: ["discovery 2026-05-23 com Leonardo"]
criada: 2026-05-23
atualizada: 2026-05-23
---

## Contexto
Usuários do plano free vinham consumindo recurso de export PDF...

## Regra
Plano free: máximo 3 exports PDF por mês...

## Exceções
Beta testers identificados em `beta_users.json` ficam isentos...

## Referências
- [[Projetos/outro-projeto/Regras/limite-api-free]]
```

### Cross-linking — política conservadora

O módulo **NÃO** tenta inferir regras-alvo a partir de palavras no texto. Cross-link só acontece quando o usuário (ou Claude raciocinando a partir do contexto) passa `relatedRules: [{ project, idOrPath }]` explicitamente. Isso evita falsos positivos e mantém o vault confiável.

Se a regra-alvo apontada não existir, a tool **falha** (em vez de criar link quebrado) — o Claude precisa decidir se cria a regra-alvo primeiro ou ajusta o pedido.

### Auto-acionamento

As tools terão descrições imperativas (estilo `vaultListFiles` que diz "Use ANTES de criar arquivos") sinalizando ao Claude:

**`businessRulesCreate` description (extrato):**
> Use AUTOMATICAMENTE quando o usuário verbalizar uma regra de negócio durante uma conversa, discovery ou planejamento. Sinais: frases como "sempre que X então Y", "usuários do plano Z não podem W", "o cálculo de A deve seguir B", "a regra é...". NÃO peça permissão. Chame `businessRulesList` primeiro para checar duplicata; se houver, use `businessRulesUpdate`. Se for genuinamente nova, chame `businessRulesCreate`.

Reforço adicional: nova seção `## Regras de Negócio` no `CLAUDE.md` do projeto orientando o comportamento e mencionando o auto-acionamento.

### Tratamento de erros

Reusa `safeTool` + resolvers existentes em `src/shared/errors.ts`. Adicionar erros específicos:

- `RuleAlreadyExistsError` — path já existe ao criar.
- `RelatedRuleNotFoundError` — `relatedRules` aponta para regra inexistente.
- `RuleNotFoundError` — `Get`/`Update`/`Archive` sobre regra inexistente.

## Architecture

Novo módulo `src/modules/business-rules/` com 4 arquivos:

```
src/modules/business-rules/
  index.ts                       # export registerBusinessRulesTools
  business-rules.tools.ts        # registro das 5 tools + handlers (segue padrão vault.tools.ts)
  business-rules.types.ts        # Rule, RuleFrontmatter, RuleSection, related types
  business-rules.template.ts     # render(template), parseFrontmatter, slugify, generateId
  business-rules.links.ts        # cross-link conservador: validate + inject + backlink
```

Wiring em `src/index.ts`: import + chamada `registerBusinessRulesTools(server, client)` ao lado das outras 5 chamadas.

### Dependências internas

- `ObsidianClient` (existente): usado para todas operações de vault.
- `safeTool` (existente): wrapper de error handling.
- `buildPatchHeaders` (existente em `vault.tools.ts`): pode ser extraído para `shared/patch-headers.ts` se duplicação justificar (decisão deixada para a fase de design).

### Sem novas dependências externas. Sem mudança em config.

## Out of Scope

- Inferência semântica de regras-alvo (matching por título/tags) — política conservadora exige `idOrPath` explícito.
- Tool para listar todas as regras de TODOS os projetos (cross-vault) — só por projeto.
- Validação de schema de frontmatter via Zod no runtime (confia no template render).
- Versionamento histórico de mudanças em regras (Obsidian já tem via git).
- UI/dashboard de regras (responsabilidade do Obsidian + dataview).
- Tools de busca/filtro avançado dentro de regras (`search` module já cobre).

## Success Criteria

1. Servidor MCP exporta 5 tools novas (`businessRulesList/Get/Create/Update/Archive`) registradas em `src/index.ts`.
2. `businessRulesCreate` produz arquivo conforme template exato, em path determinístico.
3. `relatedRules` com regra-alvo válida injeta wiki-link na nova regra E faz back-link na regra-alvo.
4. `relatedRules` com regra-alvo inexistente falha sem criar arquivo (transacional).
5. `businessRulesArchive` move regra para `_arquivadas/` e marca status.
6. Descrições das tools instruem auto-acionamento de forma clara.
7. `CLAUDE.md` do projeto recebe seção `## Regras de Negócio`.
8. `std_review` limpo nos arquivos novos.
9. `bun run build` passa sem warnings.

## Open Questions

Nenhuma — todas as decisões em aberto foram resolvidas no brainstorming:
- Localização: por projeto (`Projetos/<projeto>/Regras/`).
- Template: frontmatter rico + 4 seções.
- Operações: List/Get/Create/Update/Archive.
- Cross-link: conservador (só com `idOrPath` explícito).
- Auto-trigger: via descrição imperativa + reforço no CLAUDE.md.
