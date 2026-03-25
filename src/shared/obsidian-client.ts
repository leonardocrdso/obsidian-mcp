import { ObsidianApiError } from "./errors.js";

export class ObsidianClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string
  ) {}

  private async executeRequest(path: string, options: RequestInit = {}): Promise<Response> {
    const url = `${this.baseUrl}${path}`;

    let response: Response;
    try {
      response = await fetch(url, {
        ...options,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          ...options.headers,
        },
      });
    } catch (networkError) {
      throw new TypeError(
        `fetch failed: não foi possível conectar ao Obsidian em ${this.baseUrl}. ${networkError instanceof Error ? networkError.message : String(networkError)}`
      );
    }

    if (!response.ok) {
      let errorMessage = response.statusText;
      try {
        const body = await response.text();
        if (body) errorMessage = body;
      } catch {}
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
