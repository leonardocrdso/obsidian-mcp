export interface SimpleSearchResult {
  filename: string;
  score: number;
  matches: SimpleSearchMatch[];
}

export interface SimpleSearchMatch {
  match: { start: number; end: number };
  context: string;
}
