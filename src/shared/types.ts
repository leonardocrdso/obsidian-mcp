export type PatchOperation = "append" | "prepend" | "replace";

export type PatchTargetType = "heading" | "block" | "frontmatter";

export type Period = "daily" | "weekly" | "monthly" | "quarterly" | "yearly";

export interface NoteJson {
  content: string;
  frontmatter: Record<string, unknown>;
  path: string;
  tags: string[];
}
