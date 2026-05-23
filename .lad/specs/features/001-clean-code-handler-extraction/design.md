# Design — Clean Code Handler Extraction

## 1. Padrão de extração de handlers

### Estrutura alvo de um `<modulo>.tools.ts`

```
[imports]
[schemas Zod top-level + tipos inferidos]
[constantes locais compartilhadas (ex.: patchFields)]
[funções handler — uma por tool, prefixo handle*]
[função register*Tools — orquestrador linear]
```

### Antes / Depois — exemplo `commands.tools.ts`

**Antes** (`src/modules/commands/commands.tools.ts` atual, 40 linhas, nesting 6):

```ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ObsidianClient } from "../../shared/obsidian-client.js";
import { safeTool } from "../../shared/errors.js";

interface ObsidianCommand {
  id: string;
  name: string;
}

export function registerCommandsTools(server: McpServer, client: ObsidianClient) {
  server.tool(
    "commandsList",
    "Lista todos os comandos disponíveis no Obsidian.",
    {},
    safeTool(async () => {
      const response = await client.fetchJson<{ commands: ObsidianCommand[] }>("/commands/");
      const formatted = response.commands.map((cmd) => `${cmd.id} — ${cmd.name}`).join("\n");
      return {
        content: [{ type: "text" as const, text: formatted || "Nenhum comando encontrado." }],
      };
    })
  );

  server.tool(
    "commandsExecute",
    "Executa um comando do Obsidian pelo ID.",
    {
      commandId: z.string().describe("ID do comando a executar (ex: 'app:toggle-left-sidebar')"),
    },
    safeTool(async (params) => {
      await client.fetchVoid(`/commands/${encodeURIComponent(params.commandId)}/`, {
        method: "POST",
      });
      return {
        content: [{ type: "text" as const, text: `Comando executado: ${params.commandId}` }],
      };
    })
  );
}
```

**Depois** (mesmo arquivo, padrão alvo):

```ts
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ObsidianClient } from "../../shared/obsidian-client.js";
import { safeTool } from "../../shared/errors.js";

interface ObsidianCommand {
  id: string;
  name: string;
}

const commandsExecuteSchema = {
  commandId: z.string().describe("ID do comando a executar (ex: 'app:toggle-left-sidebar')"),
};

type CommandsExecuteParams = { commandId: string };

async function handleCommandsList(client: ObsidianClient) {
  const response = await client.fetchJson<{ commands: ObsidianCommand[] }>("/commands/");
  const formatted = response.commands.map((cmd) => `${cmd.id} — ${cmd.name}`).join("\n");
  return {
    content: [{ type: "text" as const, text: formatted || "Nenhum comando encontrado." }],
  };
}

async function handleCommandsExecute(client: ObsidianClient, params: CommandsExecuteParams) {
  await client.fetchVoid(`/commands/${encodeURIComponent(params.commandId)}/`, {
    method: "POST",
  });
  return {
    content: [{ type: "text" as const, text: `Comando executado: ${params.commandId}` }],
  };
}

export function registerCommandsTools(server: McpServer, client: ObsidianClient) {
  server.tool(
    "commandsList",
    "Lista todos os comandos disponíveis no Obsidian.",
    {},
    safeTool(() => handleCommandsList(client))
  );

  server.tool(
    "commandsExecute",
    "Executa um comando do Obsidian pelo ID.",
    commandsExecuteSchema,
    safeTool((params: CommandsExecuteParams) => handleCommandsExecute(client, params))
  );
}
```

### Observações do padrão

- **`server.tool` continua recebendo string literal idêntica** para nome e descrição — o contrato MCP fica byte-a-byte preservado.
- **Schemas continuam sendo objetos `{ campo: zSchema }`**, não `z.object({...})` — o SDK do MCP aceita ambos, mas o estilo atual do código usa o primeiro. Manter.
- **`safeTool` envolve uma arrow curta** que apenas delega para o handler. O adapter MCP injeta `params` e o arrow re-tipa quando necessário.
- **Tipos de `params`** vem inferidos via `z.infer<typeof schema>` quando o schema é declarado como const. Para evitar import circular ou complicação, basta declarar o type-alias manualmente como mostrado, espelhando o schema. Para os módulos maiores (`vault`, `periodic`, `active-file`), prefira `z.infer`.

### Variante com `z.infer` (recomendada para módulos com PATCH)

```ts
const vaultPatchSchema = {
  path: z.string().describe("..."),
  content: z.string().describe("..."),
  ...patchFields,
};

type VaultPatchParams = {
  [K in keyof typeof vaultPatchSchema]: z.infer<typeof vaultPatchSchema[K]>;
};
```

Ou, mais simples, declarar o objeto via `z.object` paralelamente só para inferência:

```ts
const vaultPatchShape = {
  path: z.string().describe("Caminho do arquivo no vault"),
  content: z.string().describe("Conteúdo a inserir"),
  ...patchFields,
} as const;

type VaultPatchParams = z.infer<z.ZodObject<typeof vaultPatchShape>>;
```

**Decisão de implementação:** o desenvolvedor pode escolher entre tipo declarado manualmente OU `z.infer` por módulo, desde que tipos batam com o schema. O critério é legibilidade local, não consistência global.

### Constante `patchFields` por módulo

Em `vault.tools.ts`, `periodic.tools.ts` e `active-file.tools.ts`, declarar uma constante local:

```ts
const patchFields = {
  operation: z.enum(["append", "prepend", "replace"]).describe("Operação: append, prepend ou replace"),
  targetType: z.enum(["heading", "block", "frontmatter"]).describe("Tipo do alvo: heading, block ou frontmatter"),
  target: z.string().describe("Identificador do alvo"),
  targetDelimiter: z.string().optional().describe("Delimitador para separar conteúdo inserido"),
  trimTargetWhitespace: z.boolean().optional().describe("Remover espaços do target antes de comparar"),
  createTargetIfMissing: z.boolean().optional().describe("Criar o alvo se não existir no arquivo"),
};
```

**Atenção:** o módulo `vault` usa `.describe("Identificador do alvo (nome do heading, ID do block, ou chave do frontmatter)")` no campo `target`, enquanto `periodic` e `active-file` usam só `"Identificador do alvo"`. Para preservar o contrato byte-a-byte, **cada módulo declara seu próprio `patchFields`** com a descrição correta. A constante `patchFields` é local ao arquivo, não importada de um lugar comum.

### Helper de cabeçalhos PATCH

Os três módulos que fazem PATCH têm o mesmo bloco de montagem de headers:

```ts
const headers: Record<string, string> = {
  "Content-Type": "text/markdown",
  Operation: params.operation,
  "Target-Type": params.targetType,
  Target: encodeURIComponent(params.target),
};
if (params.targetDelimiter) headers["Target-Delimiter"] = params.targetDelimiter;
if (params.trimTargetWhitespace !== undefined) {
  headers["Trim-Target-Whitespace"] = String(params.trimTargetWhitespace);
}
if (params.createTargetIfMissing !== undefined) {
  headers["Create-Target-If-Missing"] = String(params.createTargetIfMissing);
}
```

Extrair para **cada módulo** uma função privada do arquivo:

```ts
type PatchHeaderParams = {
  operation: PatchOperation;
  targetType: PatchTargetType;
  target: string;
  targetDelimiter?: string;
  trimTargetWhitespace?: boolean;
  createTargetIfMissing?: boolean;
};

function buildPatchHeaders(params: PatchHeaderParams): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "text/markdown",
    Operation: params.operation,
    "Target-Type": params.targetType,
    Target: encodeURIComponent(params.target),
  };
  if (params.targetDelimiter) headers["Target-Delimiter"] = params.targetDelimiter;
  if (params.trimTargetWhitespace !== undefined) {
    headers["Trim-Target-Whitespace"] = String(params.trimTargetWhitespace);
  }
  if (params.createTargetIfMissing !== undefined) {
    headers["Create-Target-If-Missing"] = String(params.createTargetIfMissing);
  }
  return headers;
}
```

**Por que local e não compartilhado:** mesma justificativa do `patchFields`. Risco de divergência futura entre módulos é menor do que acoplamento via arquivo `shared/`. Cada módulo é dono do seu domínio. Tem como follow-up unificar quando houver consumidor #4.

## 2. Estratégia para `src/shared/errors.ts`

### Antes

```ts
export function formatObsidianError(error: unknown): string {
  if (error instanceof ObsidianApiError) {
    const isInvalidTarget =
      error.statusCode === 400 && error.message.includes("invalid-target");
    const baseMessage = isInvalidTarget
      ? "O alvo (heading, block ou frontmatter) não foi encontrado..."
      : (STATUS_MESSAGES[error.statusCode] ?? "Erro inesperado na API do Obsidian.");
    const parts = [`[${error.statusCode}] ${baseMessage}`];
    if (!isInvalidTarget && error.message) parts.push(`Detalhe: ${error.message}`);
    return parts.join("\n");
  }

  if (error instanceof TypeError && error.message.includes("fetch")) {
    return [
      "[OFFLINE] Não foi possível conectar ao Obsidian.",
      "Verifique se o Obsidian está aberto e o plugin Local REST API está ativo.",
      `Detalhe: ${error.message}`,
    ].join("\n");
  }

  if (error instanceof Error) {
    return `[ERRO] ${error.message}`;
  }

  return `[ERRO] ${String(error)}`;
}
```

### Depois (alvo)

```ts
const INVALID_TARGET_MESSAGE =
  "O alvo (heading, block ou frontmatter) não foi encontrado no arquivo. Verifique se o nome existe exatamente como especificado, ou use createTargetIfMissing: true.";

const NETWORK_OFFLINE_LINES = [
  "[OFFLINE] Não foi possível conectar ao Obsidian.",
  "Verifique se o Obsidian está aberto e o plugin Local REST API está ativo.",
];

function isInvalidTargetError(error: ObsidianApiError): boolean {
  return error.statusCode === 400 && error.message.includes("invalid-target");
}

function resolveApiErrorMessage(error: ObsidianApiError): string {
  if (isInvalidTargetError(error)) {
    return `[${error.statusCode}] ${INVALID_TARGET_MESSAGE}`;
  }
  const baseMessage = STATUS_MESSAGES[error.statusCode] ?? "Erro inesperado na API do Obsidian.";
  const parts = [`[${error.statusCode}] ${baseMessage}`];
  if (error.message) parts.push(`Detalhe: ${error.message}`);
  return parts.join("\n");
}

function resolveNetworkErrorMessage(error: TypeError): string {
  return [...NETWORK_OFFLINE_LINES, `Detalhe: ${error.message}`].join("\n");
}

function isNetworkError(error: unknown): error is TypeError {
  return error instanceof TypeError && error.message.includes("fetch");
}

export function formatObsidianError(error: unknown): string {
  if (error instanceof ObsidianApiError) return resolveApiErrorMessage(error);
  if (isNetworkError(error)) return resolveNetworkErrorMessage(error);
  if (error instanceof Error) return `[ERRO] ${error.message}`;
  return `[ERRO] ${String(error)}`;
}
```

**Resultado:**
- `formatObsidianError` reduzido a 4 linhas úteis (dispatch).
- Cada resolver tem responsabilidade única e <12 linhas.
- Lookup `STATUS_MESSAGES` permanece (já é a tabela do dispatch HTTP).
- `safeTool` exportado permanece imutável.

**Atenção ao contrato de saída:** as strings finais retornadas por `formatObsidianError` devem ser byte-a-byte idênticas às de hoje para qualquer entrada. Em particular:
- Caso `invalid-target`: NÃO acrescenta `Detalhe: ...` (comportamento atual: `if (!isInvalidTarget && error.message) parts.push("Detalhe: ...")`).
- Caso API genérico: acrescenta `Detalhe: ...` somente se `error.message` for truthy.
- Caso network: sempre 3 linhas.

A função `resolveApiErrorMessage` acima preserva esse comportamento.

## 3. Estratégia para `src/shared/obsidian-client.ts`

### Antes

```ts
private async executeRequest(path: string, options: RequestInit = {}): Promise<Response> {
  const url = `${this.baseUrl}${path}`;

  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        ...options.headers,
      },
    });
  } catch (networkError) {
    throw new TypeError(
      `fetch failed: não foi possível conectar ao Obsidian em ${this.baseUrl}. ${networkError instanceof Error ? networkError.message : String(networkError)}`
    );
  }

  if (!response.ok) {
    let errorMessage = response.statusText;
    try {
      const body = await response.text();
      if (body) errorMessage = body;
    } catch {}
    throw new ObsidianApiError(errorMessage, response.status);
  }

  return response;
}
```

### Depois (alvo)

```ts
function buildAuthHeaders(apiKey: string, extra?: HeadersInit): HeadersInit {
  return {
    Authorization: `Bearer ${apiKey}`,
    ...extra,
  };
}

async function performFetch(url: string, options: RequestInit, baseUrl: string): Promise<Response> {
  try {
    return await fetch(url, options);
  } catch (networkError) {
    const detail = networkError instanceof Error ? networkError.message : String(networkError);
    throw new TypeError(
      `fetch failed: não foi possível conectar ao Obsidian em ${baseUrl}. ${detail}`
    );
  }
}

async function readErrorBody(response: Response): Promise<string> {
  try {
    const body = await response.text();
    return body || response.statusText;
  } catch {
    return response.statusText;
  }
}

export class ObsidianClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string
  ) {}

  private async executeRequest(path: string, options: RequestInit = {}): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const requestOptions: RequestInit = {
      ...options,
      headers: buildAuthHeaders(this.apiKey, options.headers),
    };

    const response = await performFetch(url, requestOptions, this.baseUrl);

    if (!response.ok) {
      const errorMessage = await readErrorBody(response);
      throw new ObsidianApiError(errorMessage, response.status);
    }

    return response;
  }

  async fetchJson<T>(path: string, options: RequestInit = {}): Promise<T> {
    const response = await this.executeRequest(path, options);
    return response.json() as Promise<T>;
  }

  async fetchText(path: string, options: RequestInit = {}): Promise<string> {
    const response = await this.executeRequest(path, options);
    return response.text();
  }

  async fetchVoid(path: string, options: RequestInit = {}): Promise<void> {
    await this.executeRequest(path, options);
  }

  encodePath(path: string): string {
    return path
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
  }
}
```

**Resultado:**
- `executeRequest` reduzido a ~9 linhas sem nesting de try/catch.
- Três helpers privados do arquivo, cada um <8 linhas com responsabilidade única.
- API pública da classe imutável (`fetchJson`, `fetchText`, `fetchVoid`, `encodePath` intactos).

**Diferença sutil:** o estado original tinha `let errorMessage = response.statusText; try { ... if (body) errorMessage = body; }`. O `readErrorBody` consolida em "body se truthy, senão statusText". Comportamento equivalente, mas a mensagem `[401] API key inválida...` produzida por `formatObsidianError` depende do `error.message` contido na `ObsidianApiError` — então, se a API retorna body vazio, continua-se usando `statusText`. Verificar smoke manual.

## 4. Estratégia para `src/shared/setup.ts`

### Estrutura alvo

```ts
function createLineBuffer(rl: Interface) {
  const lines: string[] = [];
  let waiting: ((line: string) => void) | null = null;

  rl.on("line", (line) => {
    if (waiting) {
      const resolve = waiting;
      waiting = null;
      resolve(line);
    } else {
      lines.push(line);
    }
  });

  rl.on("close", () => {
    if (waiting) {
      const resolve = waiting;
      waiting = null;
      resolve("");
    }
  });

  return {
    consume(): Promise<string> | string | null {
      if (lines.length > 0) return lines.shift()!;
      return new Promise<string>((resolve) => {
        waiting = (value) => resolve(value);
      });
    },
  };
}

function createAsk(buffer: ReturnType<typeof createLineBuffer>) {
  return async (label: string, fallback?: string): Promise<string> => {
    const suffix = fallback ? ` [${fallback}]` : "";
    process.stderr.write(`  ${label}${suffix}: `);

    const result = buffer.consume();
    if (typeof result === "string") {
      process.stderr.write(result + "\n");
      return result.trim() || fallback || "";
    }
    const value = await result;
    return value.trim() || fallback || "";
  };
}

function createPrompt() {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const buffer = createLineBuffer(rl);
  const ask = createAsk(buffer);
  return { ask, close: () => rl.close() };
}
```

**Resultado:**
- `createPrompt` reduzido a 5 linhas.
- `createLineBuffer` isolado, ~18 linhas, responsabilidade única (fila de linhas).
- `createAsk` puro em relação ao buffer, ~10 linhas.
- `runSetup` sem alteração (continua orquestrando `createPrompt` → `ask` várias vezes → `close` → `saveConfig`).

**Atenção ao detalhe atual em `ask`:**

Hoje, quando há linhas bufferizadas, o código faz:
```ts
if (lines.length > 0) {
  const value = lines.shift()!;
  process.stderr.write(value + "\n");
  return Promise.resolve(value.trim() || fallback || "");
}
```

O design alvo preserva esse comportamento exato (eco da linha no stderr quando vem de buffer + trim/fallback).

## 5. Mapa de risco por arquivo

| Arquivo | Blast radius | Risco | Mitigação |
|---------|--------------|-------|-----------|
| `commands.tools.ts` | local | LOW | Smoke: `commandsList` |
| `active-file.tools.ts` | local | LOW | Smoke: `activeFileGet` |
| `search.tools.ts` | local | LOW | Smoke: `searchSimple` |
| `periodic.tools.ts` | local | LOW | Smoke: `periodicGetNote period=daily` |
| `vault.tools.ts` | local | LOW | Smoke: `vaultListFiles` |
| `errors.ts` | consumido pelos 5 módulos (via `safeTool`) | MEDIUM | Testar pelo menos 1 caminho de erro (vault em arquivo inexistente → 404) |
| `obsidian-client.ts` | consumido por todo módulo | MEDIUM-HIGH | Testar 1 GET (vaultListFiles), 1 POST (commandsExecute) e 1 erro (vault em arquivo inexistente) |
| `setup.ts` | consumido por bootstrap | MEDIUM | `node build/index.js --setup` interativo |

## 6. Estratégia de verificação por commit

Para cada commit (1 por arquivo refatorado):

1. `bun run build` deve passar.
2. `std_review` no arquivo alterado deve mostrar zero warnings de function-length/nesting-depth.
3. Smoke manual conforme tabela acima (apenas para o arquivo do commit).

No commit final (após todos):

1. `std_review` em todos os 8 arquivos.
2. Smoke manual de AC10 (uma tool de cada módulo).
3. `git diff main..HEAD -- src/ | grep -E "^\+\s*(//|/\*)" | wc -l` retorna 0 (AC8).

## 7. Não-objetivos do design

- Não introduzir abstrações novas em `shared/` (nem `patch-schema.ts`, nem `http-helpers.ts`).
- Não trocar `safeTool` por middleware/decorator.
- Não consolidar buildPatchHeaders num shared helper.
- Não trocar `console.error` por logger.

Estes são deliberadamente adiados.