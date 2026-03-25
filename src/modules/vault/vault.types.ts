export interface VaultFile {
  path: string;
  type: "file" | "folder";
}

export interface VaultDirectory {
  files: string[];
}
