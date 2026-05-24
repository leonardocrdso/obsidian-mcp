import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ObsidianClient } from "../../shared/obsidian-client.js";
import { safeTool } from "../../shared/errors.js";
import type { TagsListResponse } from "./tags.types.js";

async function handleTagsList(client: ObsidianClient) {
  const result = await client.fetchJson<TagsListResponse>("/tags/");
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
  };
}

export function registerTagsTools(server: McpServer, client: ObsidianClient) {
  server.tool(
    "tagsList",
    [
      "Lista todas as tags do vault com a contagem de usos.",
      "Inclui tags inline (#tag) e de frontmatter; tags hierárquicas contribuem para cada prefixo (ex: 'work/tasks' soma em 'work').",
      "Resposta: { tags: [{ name, count }] } sem o prefixo '#'.",
    ].join("\n"),
    {},
    safeTool(() => handleTagsList(client))
  );
}
