#!/usr/bin/env node
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

if (process.argv.includes("--setup")) {
  const { runSetup } = await import("./shared/setup.js");
  await runSetup();
  process.exit(0);
}

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getConfig } from "./shared/config.js";
import { ObsidianClient } from "./shared/obsidian-client.js";
import { registerVaultTools } from "./modules/vault/index.js";
import { registerCommandsTools } from "./modules/commands/index.js";
import { registerSearchTools } from "./modules/search/index.js";
import { registerActiveFileTools } from "./modules/active-file/index.js";
import { registerBusinessRulesTools } from "./modules/business-rules/index.js";
import { registerPeriodicTools } from "./modules/periodic/index.js";
import { registerProjectTools } from "./modules/project/index.js";
import { registerTagsTools } from "./modules/tags/index.js";

const server = new McpServer({
  name: "obsidian-mcp",
  version: "1.0.0",
});

const config = getConfig();
const client = new ObsidianClient(config.baseUrl, config.apiKey);

registerVaultTools(server, client);
registerCommandsTools(server, client);
registerSearchTools(server, client);
registerActiveFileTools(server, client);
registerBusinessRulesTools(server, client);
registerPeriodicTools(server, client);
registerProjectTools(server, client);
registerTagsTools(server, client);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Obsidian MCP server running on stdio");
