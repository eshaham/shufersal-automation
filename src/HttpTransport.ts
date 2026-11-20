import { parseCartHtml } from './cartParser';
import { CookieJar } from './CookieJar';

export const HTTP_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';

const MAX_REDIRECTS = 5;

const BLOCK_PAGE_MAX_LENGTH = 20_000;
const BLOCK_PAGE_MARKERS = [
  'The requested URL was rejected',
  'Request Rejected',
  '_Incapsula_Resource',
  'cf-chl-',
];

export type ResponseFormat = 'json' | 'cart' | 'page' | 'text';

export interface HttpRequest {
  method: 'GET' | 'POST';
  url: string;
  body?: unknown;
  form?: Record<string, string>;
  csrfToken?: string;
}

export class LoginRedirectError extends Error {
  constructor() {
    super('REDIRECT_TO_LOGIN');
    this.name = 'LoginRedirectError';
  }
}

export class HttpBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HttpBlockedError';
  }
}

export class HttpStatusError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'HttpStatusError';
  }
}

function isRedirect(status: number): boolean {
  return status >= 300 && status < 400;
}

function looksBlocked(
  status: number,
  contentType: string,
  body: string,
): boolean {
  if (status === 403 || status === 429) {
    return true;
  }
  return (
    contentType.includes('text/html') &&
    body.length < BLOCK_PAGE_MAX_LENGTH &&
    BLOCK_PAGE_MARKERS.some((marker) => body.includes(marker))
  );
}

function truncate(body: string, contentType: string): string {
  if (contentType.includes('text/html') && body.length > 500) {
    return `${body.substring(0, 500)}... (HTML response truncated)`;
  }
  return body;
}

export class HttpTransport {
  constructor(
    private readonly jar: CookieJar,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  cookie(name: string, url: string): string | undefined {
    return this.jar.get(name, new URL(url));
  }

  async send(
    request: HttpRequest,
    format: ResponseFormat,
  ): Promise<{ status: number; data: unknown }> {
    let url = new URL(request.url);
    let method = request.method;
    let body = this.encodeBody(request);
    let response: Response | undefined;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      try {
        response = await this.fetchImpl(url, {
          method,
          headers: this.headers(url, request, method),
          body,
          redirect: 'manual',
        });
      } catch (error) {
        if (method === 'GET') {
          throw new HttpBlockedError(
            `GET ${url.pathname} failed before a response: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        throw error;
      }
      this.jar.absorb(response.headers.getSetCookie(), url);

      if (!isRedirect(response.status)) {
        break;
      }
      const location = response.headers.get('location');
      if (location?.includes('/login')) {
        await response.body?.cancel();
        throw new LoginRedirectError();
      }
      if (!location || format !== 'page') {
        break;
      }
      await response.body?.cancel();
      url = new URL(location, url);
      method = 'GET';
      body = undefined;
    }

    if (!response) {
      throw new Error(`No response for ${request.method} ${request.url}`);
    }

    const text = await response.text();
    const contentType = response.headers.get('content-type') ?? '';

    if (looksBlocked(response.status, contentType, text)) {
      throw new HttpBlockedError(
        `${request.method} ${url.pathname} looks blocked: ${String(response.status)} ${truncate(text, contentType).slice(0, 200)}`,
      );
    }

    if (format === 'text') {
      return {
        status: response.status,
        data: response.ok ? text : undefined,
      };
    }

    if (!response.ok) {
      throw new HttpStatusError(
        `Request failed: ${request.method} ${request.url} -> ${String(response.status)} ${response.statusText}. Response: ${truncate(text, contentType)}`,
        response.status,
      );
    }

    if (format === 'cart') {
      return {
        status: response.status,
        data: contentType.includes('text/html')
          ? parseCartHtml(text)
          : undefined,
      };
    }

    if (format === 'page') {
      return {
        status: response.status,
        data: { url: url.toString(), html: text },
      };
    }

    if (contentType.includes('application/json')) {
      return { status: response.status, data: JSON.parse(text) as unknown };
    }
    return { status: response.status, data: undefined };
  }

  private encodeBody(request: HttpRequest): string | undefined {
    if (request.form) {
      return new URLSearchParams(request.form).toString();
    }
    if (request.body !== undefined) {
      return JSON.stringify(request.body);
    }
    return undefined;
  }

  private headers(
    url: URL,
    request: HttpRequest,
    method: string,
  ): Record<string, string> {
    const headers: Record<string, string> = {
      'user-agent': HTTP_USER_AGENT,
      accept: 'application/json, text/plain, */*',
      'accept-language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7',
      'content-type': request.form
        ? 'application/x-www-form-urlencoded; charset=UTF-8'
        : 'application/json',
    };
    const cookie = this.jar.headerFor(url);
    if (cookie) {
      headers['cookie'] = cookie;
    }
    if (method === 'POST' && request.csrfToken) {
      headers['csrftoken'] = request.csrfToken;
    }
    return headers;
  }
}
