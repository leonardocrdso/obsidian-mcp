export type PatchHeaderParams = {
  operation: string;
  targetType: string;
  target: string;
  targetDelimiter?: string;
  trimTargetWhitespace?: boolean;
  createTargetIfMissing?: boolean;
};

export function buildPatchHeaders(params: PatchHeaderParams): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "text/markdown",
    Operation: params.operation,
    "Target-Type": params.targetType,
    Target: encodeURIComponent(params.target),
  };
  if (params.targetDelimiter) headers["Target-Delimiter"] = params.targetDelimiter;
  if (params.trimTargetWhitespace !== undefined) {
    headers["Trim-Target-Whitespace"] = String(params.trimTargetWhitespace);
  }
  if (params.createTargetIfMissing !== undefined) {
    headers["Create-Target-If-Missing"] = String(params.createTargetIfMissing);
  }
  return headers;
}
