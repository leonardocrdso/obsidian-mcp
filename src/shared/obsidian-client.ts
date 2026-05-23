import { ObsidianApiError } from "./errors.js";

function buildAuthHeaders(apiKey: string, extra?: HeadersInit): HeadersInit {
  return {
    Authorization: `Bearer ${apiKey}`,
    ...extra,
  };
}

async function performFetch(url: string, options: RequestInit, baseUrl: string): Promise<Response> {
  try {
    return await fetch(url, options);
  } catch (networkError) {
    const detail = networkError instanceof Error ? networkError.message : String(networkError);
    throw new TypeError(
      `fetch failed: não foi possível conectar ao Obsidian em ${baseUrl}. ${detail}`
    );
  }
}

async function readErrorBody(response: Response): Promise<string> {
  try {
    const body = await response.text();
    return body || response.statusText;
  } catch {
    return response.statusText;
  }
}

export class ObsidianClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string
  ) {}

  private async executeRequest(path: string, options: RequestInit = {}): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const requestOptions: RequestInit = {
      ...options,
      headers: buildAuthHeaders(this.apiKey, options.headers),
    };

    const response = await performFetch(url, requestOptions, this.baseUrl);

    if (!response.ok) {
      const errorMessage = await readErrorBody(response);
      throw new ObsidianApiError(errorMessage, response.status);
    }

    return response;
  }

  async fetchJson<T>(path: string, options: RequestInit = {}): Promise<T> {
    const response = await this.executeRequest(path, options);
    return response.json() as Promise<T>;
  }

  async fetchText(path: string, options: RequestInit = {}): Promise<string> {
    const response = await this.executeRequest(path, options);
    return response.text();
  }

  async fetchVoid(path: string, options: RequestInit = {}): Promise<void> {
    await this.executeRequest(path, options);
  }

  encodePath(path: string): string {
    return path
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
  }
}
