# Context — Clean Code Handler Extraction

## Origem do trabalho

`/lad-review` rodado em maio/2026 identificou 14 warnings de clean-code distribuídos em 8 arquivos da `src/`. Sem warning crítico. Padrão sistemático: handler MCP inline dentro de `register*Tools` causando `function-length` + `nesting-depth` 6 simultâneos.

## Mapa de warnings que motivam este SDD

| Arquivo | Linha-âncora | Warnings |
|---------|--------------|----------|
| `src/modules/vault/vault.tools.ts` | 8 (`registerVaultTools`, 179 linhas) | function-length, nesting-depth |
| `src/modules/periodic/periodic.tools.ts` | 9 (`registerPeriodicTools`, 106 linhas) | function-length, nesting-depth |
| `src/modules/active-file/active-file.tools.ts` | 6 (`registerActiveFileTools`, 99 linhas) | function-length, nesting-depth |
| `src/modules/search/search.tools.ts` | 7 (`registerSearchTools`, 64 linhas) | function-length, nesting-depth |
| `src/modules/commands/commands.tools.ts` | 11 (`registerCommandsTools`, 30 linhas) | nesting-depth |
| `src/shared/setup.ts` | 29 (`createPrompt`, 41 linhas) + 71 (`runSetup`, 24 linhas) | function-length |
| `src/shared/errors.ts` | 19 (`formatObsidianError`, 26 linhas) | function-length |
| `src/shared/obsidian-client.ts` | 16 (`executeRequest`) | nesting-depth |

## Decisões resolvidas via default sensato

Listadas em `spec.md` § "Decisões arquiteturais" (D1–D9). Cada uma marcada com `[default]` e justificativa.

## Lacunas em aberto (não bloqueantes — follow-up)

### FU1 — Schema PATCH compartilhado em `shared/`

Hoje os campos PATCH (`operation`, `targetType`, `target`, `targetDelimiter`, `trimTargetWhitespace`, `createTargetIfMissing`) aparecem em três módulos (`vault`, `periodic`, `active-file`) com shape idêntico. A descrição do campo `target` diverge: `vault` tem `"Identificador do alvo (nome do heading, ID do block, ou chave do frontmatter)"` e os outros dois têm apenas `"Identificador do alvo"`.

Este SDD opta por **não consolidar** o schema em `shared/`, mantendo `patchFields` local em cada módulo. Justificativa: preservar 100% do contrato MCP byte-a-byte sem introduzir acoplamento.

**Follow-up sugerido:** quando uma 4ª tool com PATCH aparecer (ou quando todas as descrições convergirem), abrir spec separada para consolidar em `src/shared/patch-schema.ts`.

### FU2 — `buildPatchHeaders` compartilhado

Pelo mesmo motivo de FU1, cada módulo declara seu próprio `buildPatchHeaders`. Função pura, idempotente, mesmo corpo. Follow-up para consolidação futura, gatilho: 4º consumidor.

### FU3 — Testes automatizados

Spec atual aceita via `std_review` + smoke manual. Próxima onda: instalar `bun:test` e cobrir pelo menos:
- `formatObsidianError` (4 ramos).
- `ObsidianClient.executeRequest` com fetch mockado (3 caminhos: feliz, offline, erro HTTP).
- Cada handler `handle*` exercitado com mock de `ObsidianClient`.

### FU4 — Bump de versão

Após esta refatoração ser merged, considerar `npm version patch` em PR separado se houver outra melhoria juntando. Refactor puro não dispara bump por si só.

## Riscos conhecidos

- **Diff de descrições multilinhas** em `vault.tools.ts` (3 tools usam `[...].join("\n")`). Refactor precisa preservar exatamente as strings — verificar `git diff` cuidadosamente.
- **Comportamento de `readErrorBody`** após T7: o estado atual de `executeRequest` faz `let errorMessage = response.statusText; ... if (body) errorMessage = body`. O design proposto faz `return body || response.statusText`. Equivalente para body truthy/falsy/throw, mas exige smoke do caminho 404 para confirmar mensagem amigável.
- **Setup interativo (T8):** smoke real requer cuidado para não sobrescrever `~/.obsidian-mcp.json` do dev. Recomenda-se rodar com `HOME=/tmp/test-setup`.

## Histórico de revisões

- v1 — criação inicial pelo `lad-plan` em 2026-05-23. Baseado em achados do `/lad-review` da mesma data.
