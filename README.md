# @leonardocrdso/obsidian-mcp

MCP server para integração com o Obsidian via plugin [Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api).

Cobertura completa da API com **22 tools** organizadas em 5 módulos.

## Requisitos

- [Obsidian](https://obsidian.md/) com o plugin **Local REST API** instalado e ativo
- Node.js 18+ ou [Bun](https://bun.sh/)

## Configuração

### 1. Setup interativo (recomendado)

```bash
npx @leonardocrdso/obsidian-mcp --setup
```

```
  Obsidian MCP — Configuracao

  API Key: sua-api-key-aqui
  Host [127.0.0.1]: 192.168.1.50
  Porta [27124]:
  Protocolo [https]:

  Configuracao salva em ~/.obsidian-mcp.json
```

O setup pede cada item e salva em `~/.obsidian-mcp.json`. Para reconfigurar, basta rodar `--setup` novamente.

### 2. Registrar no Claude Code

```bash
claude mcp add obsidian -- npx @leonardocrdso/obsidian-mcp
```

### Variáveis de ambiente (alternativa)

Se preferir, configure via variáveis de ambiente em vez do setup interativo:

| Variável | Obrigatória | Padrão | Descrição |
|---|---|---|---|
| `OBSIDIAN_API_KEY` | Sim | — | API key do plugin Local REST API |
| `OBSIDIAN_HOST` | Não | `127.0.0.1` | Host do Obsidian |
| `OBSIDIAN_PORT` | Não | `27124` | Porta do plugin |
| `OBSIDIAN_PROTOCOL` | Não | `https` | Protocolo (http ou https) |

```json
{
  "mcpServers": {
    "obsidian": {
      "command": "npx",
      "args": ["-y", "@leonardocrdso/obsidian-mcp"],
      "env": {
        "OBSIDIAN_API_KEY": "sua-api-key-aqui"
      }
    }
  }
}
```

Prioridade de configuração: arquivo `~/.obsidian-mcp.json` > variáveis de ambiente.

### Desenvolvimento

```bash
git clone https://github.com/leonardocrdso/obsidian-mcp.git
cd obsidian-mcp
bun install
bun run dev --setup  # configurar
bun run dev          # iniciar servidor
```

## Tools (22)

### Vault (8)
| Tool | Descrição |
|---|---|
| `vaultListFiles` | Lista arquivos e pastas do vault |
| `vaultGetFile` | Retorna conteúdo de um arquivo |
| `vaultGetMetadata` | Retorna metadata (frontmatter, tags) |
| `vaultCreateFile` | Cria ou substitui um arquivo |
| `vaultAppendContent` | Adiciona conteúdo ao final |
| `vaultPatchContent` | Insere conteúdo em local específico |
| `vaultDeleteFile` | Remove um arquivo |
| `vaultOpenFile` | Abre arquivo no Obsidian |

### Commands (2)
| Tool | Descrição |
|---|---|
| `commandsList` | Lista comandos disponíveis |
| `commandsExecute` | Executa um comando |

### Search (2)
| Tool | Descrição |
|---|---|
| `searchSimple` | Busca texto no vault |
| `searchAdvanced` | Busca com Dataview DQL ou JsonLogic |

### Active File (5)
| Tool | Descrição |
|---|---|
| `activeFileGet` | Retorna conteúdo do arquivo ativo |
| `activeFileUpdate` | Substitui conteúdo do arquivo ativo |
| `activeFileAppend` | Adiciona conteúdo ao arquivo ativo |
| `activeFilePatch` | Insere conteúdo em local específico |
| `activeFileDelete` | Remove o arquivo ativo |

### Periodic Notes (5)
| Tool | Descrição |
|---|---|
| `periodicGetNote` | Retorna nota periódica atual |
| `periodicCreateNote` | Cria/substitui nota periódica |
| `periodicAppendContent` | Adiciona conteúdo à nota periódica |
| `periodicPatchContent` | Insere conteúdo em local específico |
| `periodicDeleteNote` | Remove nota periódica |

## License

MIT
