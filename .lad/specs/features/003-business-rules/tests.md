# SPEC-003: Test Scenarios

**Tipo:** smoke tests manuais + cenários de aceite
**Sem suite automatizada** (coerente com SPEC-001/002 e restrição declarada em `spec.md`).
**Última atualização:** 2026-05-23

## Como executar

1. Build: `bun run build`.
2. Configurar `~/.obsidian-mcp.json` apontando para um vault de teste com a pasta `Projetos/`.
3. Conectar o servidor a um cliente MCP (Claude Code ou inspector).
4. Para cada cenário abaixo, executar as chamadas listadas em ordem e validar a expectativa.
5. Marcar `[x]` ao validar manualmente.

## Pré-condições compartilhadas

- Vault de teste limpo. Criar uma vez:
  - `Projetos/teste-rules/` (pasta vazia).
  - `Projetos/outro-teste/Regras/regra-pre-existente.md` com frontmatter mínimo:
    ```yaml
    ---
    id: rule-2026-05-22-regra-pre-existente
    title: Regra pré-existente
    status: ativa
    area: faturamento
    tags: []
    projetos_relacionados: [outro-teste]
    fontes: ["setup de teste"]
    criada: 2026-05-22
    atualizada: 2026-05-22
    ---

    ## Contexto
    Setup.

    ## Regra
    Setup.

    ## Exceções
    Nenhuma identificada.

    ## Referências
    ```

## Cenários

### S1. businessRulesCreate — caso feliz (sem relatedRules)

- [ ] Chamar `businessRulesCreate({ project: "teste-rules", title: "Limite de export PDF para usuários free", area: "faturamento", contexto: "...", regra: "Máximo 3 exports/mês", tags: ["export"], fontes: ["smoke S1"] })`.
- [ ] **Esperar:** retorno `{ id: "rule-2026-05-23-limite-de-export-pdf-para-usuarios-free", path: "Projetos/teste-rules/Regras/limite-de-export-pdf-para-usuarios-free.md", relatedLinks: [] }`.
- [ ] **Validar via `vaultGetFile`:** arquivo existe, frontmatter contém `status: ativa`, `criada: 2026-05-23`, `atualizada: 2026-05-23`, todas as 4 seções presentes na ordem correta.

### S2. businessRulesCreate — slug com acentos e caracteres especiais

- [ ] Chamar com `title: "Cálculo de R$ — desconto anual (até 30%)"`.
- [ ] **Esperar:** slug = `calculo-de-r-desconto-anual-ate-30`. Sem acentos, sem caracteres especiais, sem hífens duplicados.

### S3. businessRulesCreate — título totalmente inválido

- [ ] Chamar com `title: "—— ★ ★ ★ ——"` (só caracteres não-alfanuméricos).
- [ ] **Esperar:** erro `Título inválido após normalização` capturado por `safeTool`, retorno texto amigável, nenhum arquivo criado.

### S4. businessRulesCreate — duplicata

- [ ] Repetir a chamada de S1 idêntica.
- [ ] **Esperar:** `RuleAlreadyExistsError` com mensagem citando o path existente e sugerindo `businessRulesUpdate`. Arquivo original intacto.

### S5. businessRulesCreate — com relatedRules válida (cross-link + backlink)

- [ ] Chamar `businessRulesCreate({ project: "teste-rules", title: "Limite de API para plano free", area: "rate-limit", contexto: "...", regra: "...", relatedRules: [{ project: "outro-teste", idOrPath: "regra-pre-existente.md" }] })`.
- [ ] **Esperar:** retorno inclui `relatedLinks: ["[[Projetos/outro-teste/Regras/regra-pre-existente]]"]`.
- [ ] **Validar:** nova regra contém o wiki-link na seção `## Referências`.
- [ ] **Validar backlink:** `vaultGetFile("Projetos/outro-teste/Regras/regra-pre-existente.md")` mostra novo bullet `- [[Projetos/teste-rules/Regras/limite-de-api-para-plano-free]]` na `## Referências`.
- [ ] **Validar frontmatter de ambas:** `projetos_relacionados` contém `[teste-rules, outro-teste]` (em ambas, sem duplicatas).

### S6. businessRulesCreate — relatedRules inexistente (transacional)

- [ ] Chamar com `relatedRules: [{ project: "outro-teste", idOrPath: "nao-existe.md" }]`.
- [ ] **Esperar:** `RelatedRuleNotFoundError`. **Nenhum arquivo criado** (nem a nova regra, nem mutação na regra-alvo).
- [ ] **Validar:** `vaultListFiles("Projetos/teste-rules/Regras")` não inclui o slug do título tentado.

### S7. businessRulesList — projeto vazio

- [ ] Em vault limpo, chamar `businessRulesList({ project: "teste-rules" })`.
- [ ] **Esperar:** `[]` (lista vazia, sem erro).

### S8. businessRulesList — com regras + includeArchived

- [ ] Após S1+S5+S10 (arquivar uma), chamar `businessRulesList({ project: "teste-rules" })`.
- [ ] **Esperar:** retorna apenas regras ativas (não inclui arquivadas).
- [ ] Chamar `businessRulesList({ project: "teste-rules", includeArchived: true })`.
- [ ] **Esperar:** inclui também as arquivadas, com `status: arquivada`.

### S9. businessRulesGet — por id e por path

- [ ] Chamar `businessRulesGet({ project: "teste-rules", idOrPath: "rule-2026-05-23-limite-de-export-pdf-para-usuarios-free" })`.
- [ ] **Esperar:** conteúdo bruto do markdown.
- [ ] Repetir com `idOrPath: "limite-de-export-pdf-para-usuarios-free.md"`.
- [ ] **Esperar:** mesmo conteúdo.
- [ ] Repetir com `idOrPath: "inexistente"`.
- [ ] **Esperar:** `RuleNotFoundError`.

### S10. businessRulesUpdate — campo de frontmatter

- [ ] Chamar `businessRulesUpdate({ project: "teste-rules", idOrPath: "limite-de-export-pdf-para-usuarios-free.md", update: { kind: "frontmatter", key: "status", value: "obsoleta" } })`.
- [ ] **Esperar:** `vaultGetMetadata` mostra `status: obsoleta` e `atualizada: 2026-05-23`.

### S11. businessRulesUpdate — seção do corpo

- [ ] Chamar `businessRulesUpdate({ project: ..., idOrPath: ..., update: { kind: "section", section: "Exceções", operation: "append", content: "\n- Beta testers isentos." } })`.
- [ ] **Esperar:** seção `## Exceções` agora contém o novo bullet, demais seções intactas.

### S12. businessRulesUpdate — tags como array

- [ ] Chamar com `update: { kind: "frontmatter", key: "tags", value: ["export", "premium"] }`.
- [ ] **Esperar:** frontmatter mostra `tags: [export, premium]`.

### S13. businessRulesArchive — caso feliz

- [ ] Chamar `businessRulesArchive({ project: "teste-rules", idOrPath: "limite-de-export-pdf-para-usuarios-free.md" })`.
- [ ] **Esperar:** retorno `{ archivedPath: "Projetos/teste-rules/Regras/_arquivadas/limite-de-export-pdf-para-usuarios-free.md" }`.
- [ ] **Validar:** arquivo original sumiu, cópia existe em `_arquivadas/` com `status: arquivada`.

### S14. businessRulesArchive — primeiro arquivamento (pasta `_arquivadas/` ainda não existe)

- [ ] Em projeto sem `_arquivadas/`, arquivar primeira regra.
- [ ] **Esperar:** pasta criada automaticamente pelo PUT do REST API; arquivo correto dentro.

### S15. businessRulesArchive — regra inexistente

- [ ] Chamar com `idOrPath: "inexistente.md"`.
- [ ] **Esperar:** `RuleNotFoundError`, nenhuma mutação no vault.

### S16. Regressão — tools existentes não afetadas

- [ ] Chamar `vaultListFiles({})` → padrão de listagem inalterado.
- [ ] Chamar `vaultCreateFile`, `vaultPatchContent`, `periodicGetNote` → todas funcionam igual à versão anterior.
- [ ] Validar que extração de `buildPatchHeaders` para `src/shared/patch-headers.ts` (T1) não mudou comportamento.

### S17. Auto-acionamento — verificação semântica

Manualmente, em sessão Claude Code com o MCP carregado:

- [ ] Frase do usuário: "usuários free só podem exportar 3 PDFs por mês, isso é regra".
- [ ] **Esperar:** Claude chama `businessRulesList` e em seguida `businessRulesCreate` SEM pedir permissão explícita.
- [ ] Frase do usuário: "atualiza a regra de limite de export pra incluir beta testers como exceção".
- [ ] **Esperar:** Claude chama `businessRulesList`, identifica regra existente, chama `businessRulesUpdate` com `section: "Exceções"`.

### S18. README + CLAUDE.md atualizados (T9 + T10)

- [ ] `CLAUDE.md` do projeto contém seção `## Regras de Negócio` mencionando o auto-acionamento.
- [ ] `README.md` lista 27 tools no total (22 atuais + 5 novas).
- [ ] `package.json` versão bumpada para `1.3.0`.

## Critérios de aceite consolidados

A spec é considerada implementada com sucesso quando:

- [ ] Todos os cenários S1–S18 passam manualmente.
- [ ] `bun run build` finaliza sem warnings.
- [ ] `std_review` limpo em todos os arquivos novos/modificados.
- [ ] Nenhuma regressão observada em chamadas das 22 tools pré-existentes.

## Notas

- Estes cenários **não substituem** uma suite automatizada — quando o projeto adotar um framework de testes, S1–S16 podem ser portados para `bun:test` ou equivalente.
- Cenários S17 (auto-trigger) só podem ser validados em sessão real com LLM; não há como automatizar sem rodar um cliente MCP completo.
