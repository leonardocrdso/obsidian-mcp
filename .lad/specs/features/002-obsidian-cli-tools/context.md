# Context — Obsidian CLI Tools (SPEC-002)

## Origem da spec

Pedido do usuário em 2026-05-23. Feature aditiva: estender o `obsidian-mcp` (v1.1.2, 22 tools via REST API) com 12 tools novas via Obsidian CLI nativo (>= 1.12.7), sem tocar no que existe.

WebFetch da página oficial https://obsidian.md/pt-BR/help/cli foi feito pelo usuário antes do briefing. Decisão arquitetural raiz "estender, não migrar" foi tomada com ele antes desta sessão começar.

## Resoluções de lacunas (fase de planejamento)

Q&A registradas para auditoria das decisões:

### Q0 — Acesso à fonte de verdade no Obsidian

**Pergunta:** O `CLAUDE.md` do repo aponta para `Projetos/obsidian-mcp/CLAUDE.md` no vault Obsidian. Como acessar?

**Resposta:** O arquivo não existe — `obsidian-mcp` é o único projeto fora do vault. A referência no `CLAUDE.md` do repo é aspiracional. Briefing original do usuário é a fonte de verdade autoritativa.

### Q1 — Estratégia de processo CLI

**Decisão:** Spawn-por-comando (D1 da spec). Não pool persistente.

**Raciocínio:** Tools são baixa-frequência. Overhead 80–150ms aceitável. Pool quebraria o stateless do modular monolith. Reabre se medições futuras mostrarem latência problemática.

### Q2 — Granularidade de properties/tasks

**Decisão:** 5 tools separadas (`propertyGet`, `propertySet`, `propertyRemove`, `tasksList`, `taskToggle`). Sem flag `operation`.

**Raciocínio:** Regra global clean-code "Avoid Flag Arguments". Padrão atual: uma tool MCP = uma operação. Total da feature: 12 tools.

### Q3 — Alocação de move/rename

**Decisão:** Módulo `file-ops/` novo. Tools com nomes `vaultMoveFile`/`vaultRenameFile`.

**Raciocínio:** Não tocar em `vault.tools.ts` (briefing explícito). Convenção: 1 módulo = 1 client. Prefixo `vault*` é semântica, não localização física.

### Q4 — `searchContext` no módulo `search/`

**Decisão:** Adicionar no `search/` existente, com `cliClient` como 3º parâmetro de `registerSearchTools`.

**Raciocínio:** "Aditivo" = "não altera lógica existente", não "não abre o arquivo". Criar `search-cli/` fragmentaria descoberta.

### Q5 — CLI ausente: tools dormentes vs. ocultas

**Decisão:** Tools registradas, falham com mensagem amigável.

**Raciocínio decisivo:** Se a tool sumisse, LLM cliente do MCP poderia tentar workaround perigoso (ex.: simular `move` via `delete`+`create`, perdendo wikilinks — o problema que a feature resolve). Com a tool presente + erro claro, o LLM sabe que existe e reporta ao usuário "instale o CLI". Pior caso B = mensagem; pior caso A = corrupção de vault. B venceu.

### Q6 — Testes

**Decisão:** `bun:test` (built-in, sem dep nova) cobrindo `ObsidianCliClient` (com `spawn` mockado) e schemas Zod (com payloads literais). Tools individuais por smoke manual.

**Raciocínio:** Pareto. Risco real está em spawn handling + parse de JSON volátil; ambos cobertos. Tools individuais são camada fina.

### Direção extra do usuário

1. `obsidian-cli.ts` deve ter `isAvailable(): Promise<boolean>` com cache — chamado uma vez no boot, consumido por todas as tools via getter `available` síncrono.
2. Validação Zod do JSON deve falhar com mensagem citando comando exato executado (para debug em produção).

Ambas refletidas em R1 (probe cacheado) e R12 (mensagem contextual).

### Sobre módulo `project/`

Descoberto durante exploração — não estava no briefing original (que mencionava só 5 módulos atuais). Decisão registrada em D18: permanece intocado. Possível follow-up futuro (`projectInit` poderia ganhar variação CLI), fora desta spec.

## Lacunas em aberto (de implementação, não de produto)

São lacunas descobríveis em tempo de implementação. Não bloqueiam a spec porque a decisão é técnica e iterativa, não requer escolha de produto pelo usuário.

### L-impl-1 — Schema exato do CLI 1.12.7

Schemas Zod em `graph.types.ts`, `properties.types.ts`, `tasks.types.ts`, `search.types.ts` são propostas iniciais baseadas em convenções típicas. Durante T6/T7/T8/T9, executar cada tool contra Obsidian real e ajustar Zod se payload divergir.

**Ação:** ao concluir cada task de módulo (T6–T9), registrar aqui o schema real observado, se diferente do proposto.

### L-impl-2 — Serialização de array em `propertySet`

Helper `buildPropertySetArgs` na implementação inicial usa CSV. Se CLI esperar outra convenção (args repetidos, JSON inline), ajustar o helper e registrar aqui.

**Ação:** durante T7, testar `propertySet ... value=["a","b","c"] type="list"`. Documentar convenção real.

### L-impl-3 — Verificar duplicação de `format=json`

`ensureFormatJson` deve adicionar `format=json` se ausente e **não duplicar** se presente. T2 cobre isso com testes; tarefa T1 implementa.

## Decisões "fixa" vs "default" — referência rápida

Decisões marcadas `[fixa]` no spec.md (D1, D2, D3, D4, D5, D6, D7, D8, D18) não devem ser revertidas durante implementação sem reabrir a spec. As marcadas `[default]` (D9–D17, D19) podem ser ajustadas em implementação se descoberta técnica justificar — registrar aqui.

## Notas para o `lad-build` (subagent de implementação)

- Esta spec respeita `CLAUDE.md` global (sem comentários no código, consultar MCPs `clean-code` e `modular-monolith`).
- O projeto não tem testes hoje; esta spec **introduz** testes só do client CLI + schemas. Não inflar para outras camadas.
- Ordem de tasks é importante: T1 e T3 precedem qualquer módulo (T5–T9 dependem do client + erros prontos). T4 precede T11 (config nova precisa estar lá pro index usar). T2/T10 podem rodar em paralelo com tasks de módulos correspondentes desde que client esteja pronto.
- Padrão de handler segue exatamente SPEC-001 (`handle<ToolName>`, schemas const top-level, `register*Tools` orquestrador linear).
- `safeCli` é alias de `safeTool` — usar `safeCli` em handlers CLI por convenção visual.
- `child_process` do Node funciona idêntico no Bun. Sem `if (Bun) ... else ...`.
- `package.json` bump pra `1.2.0` é parte da implementação (T12), não da publicação.

## Riscos identificados

Ver seção "Riscos e mitigações" do `design.md` (R-1 a R-6). Resumo:
- Schema CLI não documentado → mitigado por validação Zod + mensagem de erro contextual + ajuste em tempo de implementação.
- Convenção de array em propertySet → helper isolado, ajuste de 3 linhas se necessário.
- Timeout em vault grande → mensagem amigável; reabrir para parametrizar.
- Schema muda entre versões → out of scope (spec corretiva futura).
- Conflito de binário no PATH → usuário configura path absoluto.
- Divergência Bun vs Node → testes em Bun + smoke em Node final.
