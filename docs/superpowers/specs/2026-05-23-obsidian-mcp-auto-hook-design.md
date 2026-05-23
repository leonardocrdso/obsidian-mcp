# obsidian-mcp: auto-hook de detecção de novo projeto

**Data:** 2026-05-23
**Status:** Aprovado para implementação
**Autor:** sessão Claude Code

## Contexto

O `projectInit` (spec anterior) existe, mas exige invocação manual. Este spec adiciona uma camada que faz Claude **invocar a tool automaticamente** ao iniciar uma sessão num repo cujo projeto ainda não tem estrutura no vault Obsidian.

Como servidores MCP são request-response e não conseguem se auto-disparar, a aproximação prática é:

1. Adicionar ao MCP um modo `--hook` que, ao ser executado, consulta o Local REST API e, se a estrutura do projeto não existir no vault, imprime um `<system-reminder>` sugerindo `projectInit`.
2. Adicionar ao fluxo `--setup` do MCP a oferta de **injetar esse hook** em `~/.claude/settings.json` (event `SessionStart`).

Ao habilitar, toda nova sessão de Claude Code dentro de um repo executa o hook, Claude vê o reminder e dispara `projectInit` por conta própria.

## Decisões já tomadas (brainstorming)

- **Escopo global**: hook em `~/.claude/settings.json`. Instala uma vez, vale para todos os repos.
- **Opt-in com default sim**: `--setup` pergunta "Instalar hook? [S/n]". Não força.
- **Detecção de projectName**: `basename(cwd)` por default. Override via arquivo `<cwd>/.obsidian-mcp/project` (uma única linha contendo o nome).
- **Fail-safe absoluto**: qualquer erro do hook (rede, config ausente, plugin offline) é silenciado. O hook **não pode quebrar** uma sessão de Claude Code.
- **Idempotente**: rodar `--setup` várias vezes não duplica entradas no `settings.json`.

## Modificações no MCP

### 1. Novo modo `--hook` em `src/index.ts`

Padrão idêntico ao `--setup` já existente:

```ts
if (process.argv.includes("--hook")) {
  const { runHook } = await import("./shared/hook.js");
  await runHook();
  process.exit(0);
}
```

Coloca antes da inicialização do `McpServer`.

### 2. Novo módulo `src/shared/hook.ts`

Responsável por:
- Resolver `projectName` (override em `<cwd>/.obsidian-mcp/project` → senão `basename(cwd)`).
- Carregar config via `getConfig()` (mesma lógica do servidor — `~/.obsidian-mcp.json` > env).
- Probar `GET /vault/Projetos/<projectName>/CLAUDE.md` (com timeout curto, 1500 ms).
- Se 404 → imprimir no stdout o `<system-reminder>` (formato em "Output do hook" abaixo).
- Se 200 → exit 0 silencioso.
- Qualquer outro erro (rede, config inválida, timeout, JSON parse) → exit 0 silencioso. **Nunca lança.**

API pública:
```ts
export async function runHook(): Promise<void>;
```

### 3. Output do hook (formato SessionStart)

O hook do Claude Code para `SessionStart` injeta no contexto do modelo o que for impresso em **stdout**. O conteúdo será:

```
<system-reminder>
O projeto "<projectName>" ainda não possui estrutura no vault Obsidian (Projetos/<projectName>/CLAUDE.md não encontrado).
Se o usuário quiser começar a documentar este projeto, invoque a tool obsidian projectInit({ projectName: "<projectName>" }) para criar a estrutura inicial.
</system-reminder>
```

Sem texto adicional. Sem newlines extras antes/depois.

### 4. Extensão do `runSetup()` em `src/shared/setup.ts`

Ao final do fluxo atual (após salvar `~/.obsidian-mcp.json`):

1. Perguntar `Instalar hook SessionStart no Claude Code? [S/n]` (default S).
2. Se a resposta começa com `n`/`N` → encerrar e imprimir mensagem de skip.
3. Caso contrário → invocar `installSessionStartHook()`.

A lógica de install fica num arquivo novo `src/shared/claude-hook-install.ts` para isolar a manipulação de `~/.claude/settings.json` do fluxo de setup.

### 5. Novo módulo `src/shared/claude-hook-install.ts`

Responsável por instalar o hook de forma idempotente e segura.

```ts
export const HOOK_EVENT = "SessionStart";
export const HOOK_COMMAND = "npx -y @leonardocrdso/obsidian-mcp --hook";

export function installSessionStartHook(): "installed" | "already_present" | "skipped_unsafe";
```

Fluxo:
1. Resolver `~/.claude/settings.json`. Se arquivo não existe → criar com `{}`.
2. Ler como JSON. Se parse falhar → retornar `skipped_unsafe` (não escrevemos por cima de JSON inválido).
3. Localizar/criar `settings.hooks.SessionStart` como array.
4. Procurar entrada existente com `hooks[].command === HOOK_COMMAND`. Se já existe → `already_present`.
5. Caso contrário, anexar:
   ```json
   {
     "matcher": "",
     "hooks": [
       { "type": "command", "command": "npx -y @leonardocrdso/obsidian-mcp --hook" }
     ]
   }
   ```
6. Escrever de volta com `JSON.stringify(data, null, 2)` + `\n` final. **Preserva todas as outras chaves do arquivo intactas.** Não reordena, não normaliza.
7. Retornar `installed`.

## Detecção de `projectName` no hook

`src/shared/hook.ts` exporta também a função pura:

```ts
export function resolveProjectName(cwd: string, readFileFn: (path: string) => string | null): string;
```

Ordem:
1. Tentar ler `${cwd}/.obsidian-mcp/project`. Trim. Se não vazio → retorna.
2. Caso contrário → `basename(cwd)`.

Funções de IO injetadas para que a lógica seja testável manualmente sem mock framework.

## Tratamento de erros

- **Config ausente** (`~/.obsidian-mcp.json` não existe E nenhuma var de ambiente válida) → exit 0 silencioso. Sem reminder.
- **Plugin Local REST API offline** (fetch falha) → exit 0 silencioso.
- **Timeout** (configurado em 1500 ms via `AbortController`) → exit 0 silencioso.
- **`projectName` impossível de resolver** (cwd = `/`, ou basename inválido com `/`/`\`/`..`) → exit 0 silencioso.
- **Resposta 200 do GET** → exit 0 silencioso (estrutura já existe).
- **Resposta 404 do GET** → imprime reminder e exit 0.
- **Qualquer outra resposta HTTP** → exit 0 silencioso (não assumimos significado).

O princípio é: hook **nunca interrompe sessão** e **nunca produz ruído** quando não tem certeza.

## Fluxo end-to-end (visão do usuário)

1. Usuário roda `npx @leonardocrdso/obsidian-mcp --setup` pela primeira vez.
2. Setup pede API key/host/porta/protocolo (fluxo já existente).
3. Setup pergunta "Instalar hook?". Usuário aceita.
4. `~/.claude/settings.json` ganha uma entrada `SessionStart`.
5. Usuário abre Claude Code dentro de `~/repos/meu-projeto`.
6. Claude Code dispara o hook → MCP roda em `--hook`, lê cwd, deriva `projectName="meu-projeto"`, bate na API.
7. Se a pasta não existe no vault → reminder injetado → Claude chama `projectInit({ projectName: "meu-projeto" })` automaticamente.
8. Se já existe → sessão começa silenciosa.

## Estrutura de arquivos no repo

```
src/shared/
├── hook.ts                    # runHook + resolveProjectName
├── claude-hook-install.ts     # installSessionStartHook + constantes
├── setup.ts                   # MODIFICADO: pergunta + invoca install
├── config.ts                  # já existe, sem mudança
├── obsidian-client.ts         # já existe, sem mudança
└── errors.ts                  # já existe, sem mudança

src/index.ts                   # MODIFICADO: branch --hook antes do setup
```

## Idempotência e UX de setup

- Rodar `--setup` 2× consecutivas: a segunda vez detecta o hook já presente e imprime "Hook já instalado.", sem alterar `settings.json`.
- Usuário pode editar `~/.claude/settings.json` manualmente para remover o hook. Próximo `--setup` reinstalará se o usuário concordar.
- Não há comando `--uninstall-hook`. Está fora de escopo desta entrega (basta editar o JSON).

## Testes

Manuais (alinhado com a decisão anterior do projeto de não ter suite automatizada):

1. **Build limpo:** `bun run build` e `npx tsc --noEmit` passam.
2. **Hook em modo "happy path":** com Obsidian rodando + Local REST API ativo + vault sem `Projetos/<projectName>` → `npx . --hook` num cwd dummy imprime o reminder no stdout, exit 0.
3. **Hook em modo "estrutura existe":** após rodar `projectInit({ projectName: "test-init" })`, executar o hook com cwd cujo basename seja `test-init` → sem output, exit 0.
4. **Hook em modo "Obsidian offline":** matar o Obsidian e rodar o hook → sem output, exit 0.
5. **Hook em modo "config ausente":** apagar `~/.obsidian-mcp.json` e limpar env vars → sem output, exit 0.
6. **Hook com override de nome:** criar `<cwd>/.obsidian-mcp/project` contendo `meu-nome-customizado` e confirmar que o reminder usa `meu-nome-customizado` em vez de `basename(cwd)`.
7. **Setup install idempotente:** rodar `--setup` 2× e confirmar que `~/.claude/settings.json` contém **uma** entrada (não duas) no array `SessionStart`.
8. **Setup install preserva dados:** antes de instalar, verificar `jq '.permissions, .env, .mcpServers' ~/.claude/settings.json` e confirmar que essas chaves continuam idênticas após o install.

## Fora de escopo

- Comando `--uninstall-hook` ou `--remove-hook`.
- Detecção via `package.json`/git remote (mantém só `basename(cwd)` + override por arquivo).
- Hook por projeto (`<cwd>/.claude/settings.json`).
- Postinstall do npm que rodaria o setup sem o usuário pedir (segurança/portabilidade — usuário ainda precisa rodar `--setup` explicitamente).
- Suporte a hooks de outros eventos (`UserPromptSubmit`, etc).

## Riscos conhecidos

- **Formato de output do `SessionStart`** depende de como Claude Code interpreta stdout do hook. O spec assume que conteúdo solto em stdout é injetado no contexto; se a versão atual exigir formato JSON estruturado (`{"reminder": "..."}` ou similar), o `runHook` precisará ajustar. **A validação manual (teste 2) é o gate dessa premissa.** Se quebrar, ajustar o formato em `hook.ts` é mudança isolada.
- **`~/.claude/settings.json` é compartilhado entre plugins/MCPs**. O install precisa de cuidado redobrado: ler + merge + escrever, nunca rewrite total. Spec exige preservação de todas as outras chaves.
- **`projectName` derivado de `basename(cwd)` colide** quando o usuário tem vários repos com o mesmo nome em pastas diferentes. Override via `.obsidian-mcp/project` é a saída prevista.
- **`npx -y @leonardocrdso/obsidian-mcp --hook` adiciona latência** (~200-500ms de startup) a cada `SessionStart`. Aceito como custo dentro do orçamento normal de hooks. Se virar problema, pode-se cachear via `bin` resolvido ou via daemon, fora de escopo agora.
