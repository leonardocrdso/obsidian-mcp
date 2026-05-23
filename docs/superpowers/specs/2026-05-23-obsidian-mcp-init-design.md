# obsidian-mcp: `projectInit` tool

**Data:** 2026-05-23
**Status:** Aprovado para implementação
**Autor:** sessão Claude Code

## Contexto

O servidor MCP `obsidian-mcp` expõe 22 tools para manipular um vault Obsidian via Local REST API, mas não oferece um caminho rápido para **bootstrapar a estrutura de um novo projeto** dentro do vault. Hoje o usuário precisa criar manualmente a pasta `Projetos/<nome>/` e os arquivos iniciais.

Este spec adiciona uma tool `projectInit` que cria essa estrutura de forma idempotente.

## Decisões já tomadas (brainstorming)

- **Vault único compartilhado**: o init opera dentro do vault que já está conectado ao MCP. Não cria vault novo. Namespace padrão é `Projetos/<projectName>/`.
- **Idempotente, não-destrutivo**: para cada arquivo, faz probe via `GET`. Se 404, cria; se 200, mantém intacto e reporta `already_existed`.
- **Estrutura favorece append-by-new-file**: subpastas materializadas via seed `README.md`, de modo que sessões concorrentes editem arquivos diferentes em vez de competir pelo mesmo arquivo.
- **Tool mínima**: nada de `projectList`, `projectArchive` etc. nesta entrega. Escopo é só `projectInit`.

## Tool

### Nome
`projectInit`

### Parâmetros

| Nome | Tipo | Obrigatório | Default | Descrição |
|---|---|---|---|---|
| `projectName` | string | sim | — | Nome do projeto. Vira o nome da pasta. |
| `description` | string | não | `""` | Texto livre injetado no CLAUDE.md. |
| `basePath` | string | não | `"Projetos"` | Pasta-raiz onde o projeto será criado. |

### Validação (Zod)

- `projectName`: `min(1)`, sem `/`, `\`, ou `..` (anti path traversal).
- `basePath`: `min(1)`, sem `..` (permite `/` para suportar caminhos aninhados como `Trabalho/Clientes`).
- `description`: qualquer string.

## Estrutura criada

```
<basePath>/<projectName>/
├── CLAUDE.md
├── Regras/README.md
├── Decisões/README.md
└── Notas/README.md
```

**Razão dos README.md seed:** Local REST API/Obsidian não persiste diretórios vazios. Um arquivo dentro força a pasta a existir e simultaneamente documenta o propósito da subpasta.

## Templates

### `CLAUDE.md`

```markdown
# {projectName}

{description || "_Adicione descrição aqui._"}

## Estrutura

- `Regras/` — regras de negócio (um arquivo por regra; use slug + timestamp)
- `Decisões/` — ADRs (um arquivo por decisão)
- `Notas/` — inbox de anotações

## Stack

## Links
```

### `Regras/README.md`

```markdown
# Regras de Negócio

Cada regra fica em seu próprio arquivo `<slug>.md` para evitar conflitos entre sessões concorrentes.

Convenção de nome: `<slug-curto>.md` ou `<YYYY-MM-DD>-<slug>.md`.
```

### `Decisões/README.md`

```markdown
# Decisões (ADRs)

Cada decisão arquitetural fica em seu próprio arquivo.

Convenção de nome: `<YYYY-MM-DD>-<slug>.md`.
```

### `Notas/README.md`

```markdown
# Notas

Inbox de anotações livres do projeto. Sem estrutura imposta.
```

## Fluxo de execução

API real do `ObsidianClient` (ver `src/shared/obsidian-client.ts`):
- Probe via `client.fetchText('/vault/' + client.encodePath(path))` (GET).
- Escrita via `client.fetchVoid('/vault/' + client.encodePath(path), { method: 'PUT', headers: { 'Content-Type': 'text/markdown' }, body: content })`.
- Erros HTTP viram `ObsidianApiError` com `statusCode` (ver `src/shared/errors.ts`).

Para cada um dos 4 caminhos-alvo (CLAUDE.md + 3 READMEs):

1. Tentar `fetchText`.
2. Se cair em catch com `error instanceof ObsidianApiError && error.statusCode === 404` → fazer PUT via `fetchVoid`; adicionar path em `created`.
3. Se `fetchText` retornar normalmente → adicionar path em `alreadyExisted` (não toca no arquivo).
4. Outro erro (rede, 5xx, 401, etc.) → propagar (handler de `safeTool` formata).

Ordem de processamento determinística (CLAUDE.md primeiro, depois Regras, Decisões, Notas). O Local REST API cria diretórios intermediários automaticamente quando o PUT do arquivo é feito (comportamento herdado do uso existente em `vaultCreateFile`, que já assume isso). Caso a implementação observe que pastas vazias não persistem mesmo após o PUT do README, o README seed dentro de cada subpasta materializa a pasta de qualquer forma.

## Retorno (JSON serializado no content do MCP)

```ts
type ProjectInitResult = {
  basePath: string;          // "Projetos"
  projectName: string;       // "meu-projeto"
  rootPath: string;          // "Projetos/meu-projeto"
  created: string[];         // paths criados nesta execução
  alreadyExisted: string[];  // paths que já existiam
  paths: {
    claudeMd: string;        // "Projetos/meu-projeto/CLAUDE.md"
    regras: string;          // "Projetos/meu-projeto/Regras/README.md"
    decisoes: string;        // "Projetos/meu-projeto/Decisões/README.md"
    notas: string;           // "Projetos/meu-projeto/Notas/README.md"
  };
};
```

## Estrutura de arquivos no repo

```
src/modules/project/
├── index.ts              # export { registerProjectTools }
├── project.tools.ts      # registra `projectInit`, schema Zod, handler
├── project.templates.ts  # constantes com os templates + função buildClaudeMd(projectName, description)
└── project.types.ts      # tipos ProjectInitParams, ProjectInitResult, FileSeed
```

Padrão segue os 5 módulos existentes (`vault`, `commands`, `search`, `active-file`, `periodic`).

## Integração

`src/index.ts` ganha:

```ts
import { registerProjectTools } from "./modules/project/index.js";
// ...
registerProjectTools(server, client);
```

## Tratamento de erros

- Reusa `safeTool` de `src/shared/errors.ts` (mesmo padrão dos outros módulos).
- Erros 404 do GET probe são **esperados** — não devem ser logados como erro. Capturados via `try/catch` ou via type-guard contra `NotFoundError` existente em `errors.ts`.
- Erros de validação Zod retornam pela infraestrutura MCP normal.

## Testes

O projeto não tem suite de testes automatizada. Validação será manual:

1. `bun run build` deve passar sem warnings.
2. Subir `bun run dev`, configurar contra vault local de teste, disparar `projectInit({ projectName: "test-init" })` via cliente MCP.
3. Verificar no Obsidian que as 4 entradas aparecem com o conteúdo esperado.
4. Disparar `projectInit` novamente com o mesmo nome → todos os 4 paths devem retornar em `alreadyExisted`, nenhum em `created`.
5. Disparar com `description: "..."` em projeto novo → confirmar que o texto aparece no CLAUDE.md.
6. Tentar `projectName: "../escape"` → deve falhar com erro de validação.

## Fora de escopo

- `projectList`, `projectArchive`, `projectRename` — futuras tools do mesmo módulo.
- Locking ou MVCC para escritas concorrentes pós-init (problema do vault layer, não desta feature).
- Suite de testes automatizada para o projeto.
- Documentação atualizada no `README.md` raiz (ficará para o PR de implementação, não é parte do spec).

## Riscos conhecidos

- **Probe + write não é atômico**: duas sessões disparando `projectInit` no mesmo nome no mesmo instante podem ambas ver 404 e ambas criar, com a segunda sobrescrevendo a primeira. Aceito como improvável (uso humano, vault pessoal). Mitigação possível no futuro: usar `If-None-Match: *` se o plugin Local REST API suportar.
- **Nomes com caracteres especiais (acentos, espaços)** no `projectName` podem dar comportamento inesperado no plugin/sistema de arquivos. Validação Zod cobre só os casos perigosos (`/`, `\`, `..`); outros caracteres são passados como vieram.
