import type { CookieData } from 'puppeteer-core';

function normalizeDomain(domain: string): string {
  return domain.replace(/^\./, '').toLowerCase();
}

function cookieKey(cookie: CookieData): string {
  return `${cookie.name};${normalizeDomain(cookie.domain)};${cookie.path ?? '/'}`;
}

function isExpired(cookie: CookieData, now: number): boolean {
  return (
    cookie.expires !== undefined &&
    cookie.expires > 0 &&
    cookie.expires * 1000 <= now
  );
}

function domainMatches(host: string, cookieDomain: string): boolean {
  const domain = normalizeDomain(cookieDomain);
  return host === domain || host.endsWith(`.${domain}`);
}

function parseSameSite(value: string): CookieData['sameSite'] {
  const normalized = value.toLowerCase();
  if (normalized === 'strict') {
    return 'Strict';
  }
  if (normalized === 'lax') {
    return 'Lax';
  }
  if (normalized === 'none') {
    return 'None';
  }
  return undefined;
}

export function parseSetCookie(
  header: string,
  requestUrl: URL,
  now = Date.now(),
): { cookie: CookieData; deleted: boolean } | null {
  const [pair, ...attributes] = header.split(';');
  const separator = pair.indexOf('=');
  if (separator <= 0) {
    return null;
  }

  const cookie: CookieData = {
    name: pair.slice(0, separator).trim(),
    value: pair.slice(separator + 1).trim(),
    domain: requestUrl.hostname,
    path: '/',
  };
  let deleted = false;

  for (const attribute of attributes) {
    const index = attribute.indexOf('=');
    const key = (index === -1 ? attribute : attribute.slice(0, index))
      .trim()
      .toLowerCase();
    const value = index === -1 ? '' : attribute.slice(index + 1).trim();

    if (key === 'domain' && value) {
      cookie.domain = `.${normalizeDomain(value)}`;
    } else if (key === 'path' && value.startsWith('/')) {
      cookie.path = value;
    } else if (key === 'max-age') {
      const seconds = Number(value);
      if (!Number.isNaN(seconds)) {
        deleted = seconds <= 0;
        cookie.expires = Math.floor(now / 1000) + seconds;
      }
    } else if (key === 'expires' && cookie.expires === undefined) {
      const time = Date.parse(value);
      if (!Number.isNaN(time)) {
        deleted = time <= now;
        cookie.expires = Math.floor(time / 1000);
      }
    } else if (key === 'secure') {
      cookie.secure = true;
    } else if (key === 'httponly') {
      cookie.httpOnly = true;
    } else if (key === 'samesite') {
      cookie.sameSite = parseSameSite(value);
    }
  }

  return { cookie, deleted };
}

export class CookieJar {
  private readonly cookies = new Map<string, CookieData>();

  constructor(cookies: CookieData[] = []) {
    this.replaceAll(cookies);
  }

  replaceAll(cookies: CookieData[]): void {
    this.cookies.clear();
    for (const cookie of cookies) {
      if (cookie.name && cookie.domain) {
        this.cookies.set(cookieKey(cookie), cookie);
      }
    }
  }

  absorb(setCookieHeaders: string[], requestUrl: URL): void {
    for (const header of setCookieHeaders) {
      const parsed = parseSetCookie(header, requestUrl);
      if (!parsed) {
        continue;
      }
      const key = cookieKey(parsed.cookie);
      if (parsed.deleted) {
        this.cookies.delete(key);
      } else {
        this.cookies.set(key, parsed.cookie);
      }
    }
  }

  headerFor(url: URL, now = Date.now()): string {
    const host = url.hostname.toLowerCase();
    return Array.from(this.cookies.values())
      .filter(
        (cookie) =>
          !isExpired(cookie, now) &&
          domainMatches(host, cookie.domain) &&
          url.pathname.startsWith(cookie.path ?? '/') &&
          (!cookie.secure || url.protocol === 'https:'),
      )
      .sort((a, b) => (b.path ?? '/').length - (a.path ?? '/').length)
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join('; ');
  }

  get(name: string, url: URL): string | undefined {
    const host = url.hostname.toLowerCase();
    return Array.from(this.cookies.values()).find(
      (cookie) => cookie.name === name && domainMatches(host, cookie.domain),
    )?.value;
  }

  toCookieData(): CookieData[] {
    return Array.from(this.cookies.values());
  }
}
