export type ProjectInitParams = {
  projectName: string;
  description?: string;
  basePath?: string;
};

export type FileSeed = {
  key: "claudeMd" | "regras" | "decisoes" | "notas";
  path: string;
  content: string;
};

export type ProjectInitResult = {
  basePath: string;
  projectName: string;
  rootPath: string;
  created: string[];
  alreadyExisted: string[];
  paths: {
    claudeMd: string;
    regras: string;
    decisoes: string;
    notas: string;
  };
};
