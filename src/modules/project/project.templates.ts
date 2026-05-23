const CLAUDE_MD_DEFAULT_DESCRIPTION = "_Adicione descrição aqui._";

const CLAUDE_MD_BODY = [
  "## Estrutura",
  "",
  "- `Regras/` — regras de negócio (um arquivo por regra; use slug + timestamp)",
  "- `Decisões/` — ADRs (um arquivo por decisão)",
  "- `Notas/` — inbox de anotações",
  "",
  "## Stack",
  "",
  "## Links",
  "",
].join("\n");

export function buildClaudeMd(projectName: string, description: string): string {
  const desc = description.trim().length > 0 ? description.trim() : CLAUDE_MD_DEFAULT_DESCRIPTION;
  return [`# ${projectName}`, "", desc, "", CLAUDE_MD_BODY].join("\n");
}

export const REGRAS_README = [
  "# Regras de Negócio",
  "",
  "Cada regra fica em seu próprio arquivo `<slug>.md` para evitar conflitos entre sessões concorrentes.",
  "",
  "Convenção de nome: `<slug-curto>.md` ou `<YYYY-MM-DD>-<slug>.md`.",
  "",
].join("\n");

export const DECISOES_README = [
  "# Decisões (ADRs)",
  "",
  "Cada decisão arquitetural fica em seu próprio arquivo.",
  "",
  "Convenção de nome: `<YYYY-MM-DD>-<slug>.md`.",
  "",
].join("\n");

export const NOTAS_README = [
  "# Notas",
  "",
  "Inbox de anotações livres do projeto. Sem estrutura imposta.",
  "",
].join("\n");
