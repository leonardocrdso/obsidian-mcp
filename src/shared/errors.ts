export class ObsidianApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
    this.name = "ObsidianApiError";
  }
}

const STATUS_MESSAGES: Record<number, string> = {
  400: "Requisição inválida. Verifique os parâmetros enviados.",
  401: "API key inválida ou ausente. Verifique a configuração do plugin Local REST API.",
  404: "Arquivo ou recurso não encontrado no vault.",
  405: "Operação não suportada pela API do Obsidian.",
  500: "Erro interno do Obsidian.",
};

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

function isNetworkError(error: unknown): error is TypeError {
  return error instanceof TypeError && error.message.includes("fetch");
}

function resolveNetworkErrorMessage(error: TypeError): string {
  return [...NETWORK_OFFLINE_LINES, `Detalhe: ${error.message}`].join("\n");
}

export function formatObsidianError(error: unknown): string {
  if (error instanceof ObsidianApiError) return resolveApiErrorMessage(error);
  if (isNetworkError(error)) return resolveNetworkErrorMessage(error);
  if (error instanceof Error) return `[ERRO] ${error.message}`;
  return `[ERRO] ${String(error)}`;
}

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
type ToolHandler<T extends unknown[] = unknown[]> = (...args: T) => Promise<ToolResult>;

export function safeTool<T extends unknown[]>(handler: ToolHandler<T>): ToolHandler<T> {
  return (async (...args: T) => {
    try {
      return await handler(...args);
    } catch (error) {
      const message = formatObsidianError(error);
      return {
        content: [{ type: "text" as const, text: message }],
        isError: true,
      };
    }
  }) as ToolHandler<T>;
}
