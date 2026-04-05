import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ObsidianClient } from "../../shared/obsidian-client.js";
import type { NoteJson, PatchOperation, PatchTargetType } from "../../shared/types.js";
import { safeTool } from "../../shared/errors.js";
import type { VaultDirectory } from "./vault.types.js";

export function registerVaultTools(server: McpServer, client: ObsidianClient) {
  server.tool(
    "vaultListFiles",
    [
      "Lista arquivos e pastas de um diretório do vault. Sem parâmetros lista a raiz.",
      "",
      "IMPORTANTE: Use esta tool ANTES de criar arquivos para entender a estrutura de pastas existente.",
      "Navegue pela raiz e subpastas para mapear como o vault está organizado por assunto.",
      "Pastas terminam com '/' no resultado.",
    ].join("\n"),
    {
      path: z.string().optional().describe("Caminho do diretório no vault (ex: 'Notes/Projects')"),
    },
    safeTool(async (params) => {
      const dirPath = params.path ? `${client.encodePath(params.path)}/` : "";
      const result = await client.fetchJson<VaultDirectory>(`/vault/${dirPath}`);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    })
  );

  server.tool(
    "vaultGetFile",
    "Retorna o conteúdo de um arquivo do vault.",
    {
      path: z.string().describe("Caminho do arquivo no vault (ex: 'Notes/meu-arquivo.md')"),
    },
    safeTool(async (params) => {
      const text = await client.fetchText(`/vault/${client.encodePath(params.path)}`);
      return {
        content: [{ type: "text" as const, text }],
      };
    })
  );

  server.tool(
    "vaultGetMetadata",
    "Retorna metadata de um arquivo (frontmatter, tags, path) em formato JSON.",
    {
      path: z.string().describe("Caminho do arquivo no vault"),
    },
    safeTool(async (params) => {
      const metadata = await client.fetchJson<NoteJson>(
        `/vault/${client.encodePath(params.path)}`,
        { headers: { Accept: "application/vnd.olrapi.note+json" } }
      );
      return {
        content: [{ type: "text" as const, text: JSON.stringify(metadata, null, 2) }],
      };
    })
  );

  server.tool(
    "vaultCreateFile",
    [
      "Cria ou substitui um arquivo no vault.",
      "",
      "ANTES de chamar esta tool, você DEVE:",
      "1. Usar vaultListFiles (sem parâmetros) para ver as pastas raiz do vault.",
      "2. Explorar as subpastas relevantes para entender a organização por assunto.",
      "3. Escolher a pasta que melhor se encaixa no tema do arquivo sendo criado.",
      "4. Se nenhuma pasta existente fizer sentido, crie uma nova seguindo o padrão de nomenclatura já usado no vault.",
      "",
      "NUNCA crie arquivos soltos na raiz se houver uma estrutura de pastas organizada.",
      "O objetivo é manter o vault coerente — cada arquivo deve estar na pasta que melhor representa seu assunto.",
    ].join("\n"),
    {
      path: z.string().describe("Caminho completo do arquivo incluindo a pasta adequada (ex: 'Projetos/meu-projeto/reuniao.md')"),
      content: z.string().describe("Conteúdo do arquivo"),
    },
    safeTool(async (params) => {
      await client.fetchVoid(`/vault/${client.encodePath(params.path)}`, {
        method: "PUT",
        headers: { "Content-Type": "text/markdown" },
        body: params.content,
      });
      return {
        content: [{ type: "text" as const, text: `Arquivo criado: ${params.path}` }],
      };
    })
  );

  server.tool(
    "vaultAppendContent",
    [
      "Adiciona conteúdo ao final de um arquivo existente no vault.",
      "",
      "Se não souber o path exato do arquivo, use vaultListFiles para navegar pelas pastas e encontrá-lo.",
    ].join("\n"),
    {
      path: z.string().describe("Caminho do arquivo no vault"),
      content: z.string().describe("Conteúdo a adicionar ao final"),
    },
    safeTool(async (params) => {
      await client.fetchVoid(`/vault/${client.encodePath(params.path)}`, {
        method: "POST",
        headers: { "Content-Type": "text/markdown" },
        body: params.content,
      });
      return {
        content: [{ type: "text" as const, text: `Conteúdo adicionado a: ${params.path}` }],
      };
    })
  );

  server.tool(
    "vaultPatchContent",
    "Insere conteúdo em um local específico de um arquivo (heading, block ou frontmatter).",
    {
      path: z.string().describe("Caminho do arquivo no vault"),
      content: z.string().describe("Conteúdo a inserir"),
      operation: z.enum(["append", "prepend", "replace"]).describe("Operação: append, prepend ou replace"),
      targetType: z.enum(["heading", "block", "frontmatter"]).describe("Tipo do alvo: heading, block ou frontmatter"),
      target: z.string().describe("Identificador do alvo (nome do heading, ID do block, ou chave do frontmatter)"),
      targetDelimiter: z.string().optional().describe("Delimitador para separar conteúdo inserido (ex: '\\n')"),
      trimTargetWhitespace: z.boolean().optional().describe("Remover espaços do target antes de comparar"),
      createTargetIfMissing: z.boolean().optional().describe("Criar o alvo se não existir no arquivo"),
    },
    safeTool(async (params) => {
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

      await client.fetchVoid(`/vault/${client.encodePath(params.path)}`, {
        method: "PATCH",
        headers,
        body: params.content,
      });
      return {
        content: [{ type: "text" as const, text: `Conteúdo atualizado em: ${params.path}` }],
      };
    })
  );

  server.tool(
    "vaultDeleteFile",
    "Remove um arquivo do vault.",
    {
      path: z.string().describe("Caminho do arquivo a remover"),
    },
    safeTool(async (params) => {
      await client.fetchVoid(`/vault/${client.encodePath(params.path)}`, {
        method: "DELETE",
      });
      return {
        content: [{ type: "text" as const, text: `Arquivo removido: ${params.path}` }],
      };
    })
  );

  server.tool(
    "vaultOpenFile",
    "Abre um arquivo no Obsidian.",
    {
      path: z.string().describe("Caminho do arquivo a abrir no Obsidian"),
      newLeaf: z.boolean().optional().describe("Abrir em nova aba (padrão: false)"),
    },
    safeTool(async (params) => {
      const query = params.newLeaf ? "?newLeaf=true" : "";
      await client.fetchVoid(`/open/${client.encodePath(params.path)}${query}`, {
        method: "POST",
      });
      return {
        content: [{ type: "text" as const, text: `Arquivo aberto: ${params.path}` }],
      };
    })
  );
}
