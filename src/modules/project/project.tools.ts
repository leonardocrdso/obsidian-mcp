import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ObsidianClient } from "../../shared/obsidian-client.js";
import { ObsidianApiError, safeTool } from "../../shared/errors.js";
import type { FileSeed, ProjectInitParams, ProjectInitResult } from "./project.types.js";
import {
  buildClaudeMd,
  DECISOES_README,
  NOTAS_README,
  REGRAS_README,
} from "./project.templates.js";

const projectNameSchema = z
  .string()
  .min(1, "projectName não pode ser vazio")
  .refine((value) => !value.includes(".."), "projectName não pode conter '..'")
  .refine((value) => !value.includes("/"), "projectName não pode conter '/'")
  .refine((value) => !value.includes("\\"), "projectName não pode conter '\\'");

const basePathSchema = z
  .string()
  .min(1, "basePath não pode ser vazio")
  .refine((value) => !value.includes(".."), "basePath não pode conter '..'");

const projectInitSchema = {
  projectName: projectNameSchema.describe("Nome do projeto. Vira o nome da pasta dentro de basePath."),
  description: z.string().optional().describe("Descrição livre injetada no CLAUDE.md (opcional)."),
  basePath: basePathSchema.optional().describe("Pasta-raiz onde o projeto será criado. Default: 'Projetos'."),
};

const DEFAULT_BASE_PATH = "Projetos";

function buildSeeds(rootPath: string, projectName: string, description: string): FileSeed[] {
  return [
    { key: "claudeMd", path: `${rootPath}/CLAUDE.md`, content: buildClaudeMd(projectName, description) },
    { key: "regras", path: `${rootPath}/Regras/README.md`, content: REGRAS_README },
    { key: "decisoes", path: `${rootPath}/Decisões/README.md`, content: DECISOES_README },
    { key: "notas", path: `${rootPath}/Notas/README.md`, content: NOTAS_README },
  ];
}

async function fileExists(client: ObsidianClient, path: string): Promise<boolean> {
  try {
    await client.fetchText(`/vault/${client.encodePath(path)}`);
    return true;
  } catch (error) {
    if (error instanceof ObsidianApiError && error.statusCode === 404) return false;
    throw error;
  }
}

async function createFile(client: ObsidianClient, path: string, content: string): Promise<void> {
  await client.fetchVoid(`/vault/${client.encodePath(path)}`, {
    method: "PUT",
    headers: { "Content-Type": "text/markdown" },
    body: content,
  });
}

async function ensureSeed(
  client: ObsidianClient,
  seed: FileSeed,
  created: string[],
  alreadyExisted: string[]
): Promise<void> {
  const exists = await fileExists(client, seed.path);
  if (exists) {
    alreadyExisted.push(seed.path);
    return;
  }
  await createFile(client, seed.path, seed.content);
  created.push(seed.path);
}

async function handleProjectInit(
  client: ObsidianClient,
  params: ProjectInitParams
): Promise<{ content: { type: "text"; text: string }[] }> {
  const basePath = params.basePath ?? DEFAULT_BASE_PATH;
  const description = params.description ?? "";
  const rootPath = `${basePath}/${params.projectName}`;
  const seeds = buildSeeds(rootPath, params.projectName, description);
  const created: string[] = [];
  const alreadyExisted: string[] = [];

  for (const seed of seeds) {
    await ensureSeed(client, seed, created, alreadyExisted);
  }

  const result: ProjectInitResult = {
    basePath,
    projectName: params.projectName,
    rootPath,
    created,
    alreadyExisted,
    paths: {
      claudeMd: seeds[0].path,
      regras: seeds[1].path,
      decisoes: seeds[2].path,
      notas: seeds[3].path,
    },
  };

  return {
    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
  };
}

export function registerProjectTools(server: McpServer, client: ObsidianClient) {
  server.tool(
    "projectInit",
    [
      "Inicializa a estrutura de um projeto dentro do vault Obsidian.",
      "",
      "Cria <basePath>/<projectName>/ com CLAUDE.md + subpastas Regras/, Decisões/, Notas/ (cada uma com um README.md seed).",
      "Operação idempotente: arquivos que já existem não são tocados; o retorno indica o que foi criado vs já existia.",
      "Use sempre que iniciar um novo projeto que ainda não tenha estrutura no Obsidian.",
    ].join("\n"),
    projectInitSchema,
    safeTool((params: ProjectInitParams) => handleProjectInit(client, params))
  );
}
