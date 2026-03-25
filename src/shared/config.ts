function loadConfig() {
  const apiKey = process.env.OBSIDIAN_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OBSIDIAN_API_KEY não configurada. Defina a variável de ambiente com a API key do plugin Local REST API."
    );
  }

  const host = process.env.OBSIDIAN_HOST ?? "127.0.0.1";
  const port = process.env.OBSIDIAN_PORT ?? "27124";
  const protocol = process.env.OBSIDIAN_PROTOCOL ?? "https";
  const baseUrl = `${protocol}://${host}:${port}`;

  return { apiKey, host, port, protocol, baseUrl } as const;
}

export const config = loadConfig();
