export type RuleStatus = "ativa" | "arquivada";

export type RuleFrontmatter = {
  id: string;
  title: string;
  status: RuleStatus;
  area: string;
  tags: string[];
  projetos_relacionados: string[];
  fontes: string[];
  criada: string;
  atualizada: string;
};

export type RuleListEntry = {
  id: string;
  title: string;
  status: string;
  area: string;
  path: string;
  archived: boolean;
};

export type RelatedRuleRef = {
  project: string;
  idOrPath: string;
};

export type RenderRuleParams = {
  id: string;
  title: string;
  status: RuleStatus;
  area: string;
  tags: string[];
  projetosRelacionados: string[];
  fontes: string[];
  criada: string;
  atualizada: string;
  contexto: string;
  regra: string;
  excecoes: string;
  referencias: string[];
};

export type CreateRuleParams = {
  project: string;
  title: string;
  area: string;
  contexto: string;
  regra: string;
  excecoes?: string;
  tags?: string[];
  fontes?: string[];
  relatedRules?: RelatedRuleRef[];
};

export type UpdateFrontmatterUpdate = {
  kind: "frontmatter";
  key: "status" | "area" | "tags" | "fontes";
  value: string | string[];
};

export type UpdateSectionUpdate = {
  kind: "section";
  section: "Contexto" | "Regra" | "Exceções" | "Referências";
  operation: "append" | "prepend" | "replace";
  content: string;
};

export type UpdateRuleParams = {
  project: string;
  idOrPath: string;
  update: UpdateFrontmatterUpdate | UpdateSectionUpdate;
};
