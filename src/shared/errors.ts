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

export function formatObsidianError(error: unknown): string {
  if (error instanceof ObsidianApiError) {
    const baseMessage = STATUS_MESSAGES[error.statusCode] ?? "Erro inesperado na API do Obsidian.";
    const parts = [`[${error.statusCode}] ${baseMessage}`];
    if (error.message) parts.push(`Detalhe: ${error.message}`);
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
