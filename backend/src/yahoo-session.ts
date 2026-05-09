import axios, { AxiosRequestConfig } from 'axios';

export const YAHOO_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';

const COOKIE_TTL_MS = 55 * 60 * 1000;
const CRUMB_TTL_MS = 55 * 60 * 1000;

interface CookieCache {
  cookie: string;
  at: number;
}

interface CrumbCache {
  crumb: string;
  at: number;
}

let cookieCache: CookieCache | null = null;
let crumbCache: CrumbCache | null = null;
let cookiePending: Promise<string> | null = null;
let crumbPending: Promise<string> | null = null;

async function fetchCookie(): Promise<string> {
  const r = await axios.get('https://finance.yahoo.com', {
    timeout: 10000,
    headers: {
      'User-Agent': YAHOO_UA,
      Accept: 'text/html,application/xhtml+xml,*/*',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    maxRedirects: 5,
  });
  const raw: string[] = (r.headers['set-cookie'] as string[] | undefined) ?? [];
  return raw.map((c) => c.split(';')[0]).join('; ');
}

async function fetchCrumb(cookie: string): Promise<string> {
  for (const host of ['query1', 'query2'] as const) {
    try {
      const r = await axios.get<string>(
        `https://${host}.finance.yahoo.com/v1/test/getcrumb`,
        {
          timeout: 10000,
          headers: { 'User-Agent': YAHOO_UA, Accept: '*/*', Cookie: cookie },
          responseType: 'text',
        },
      );
      const crumb = String(r.data).trim();
      if (crumb && crumb.length <= 20 && !/[Rr]equest/.test(crumb)) return crumb;
    } catch {
      // try next host
    }
  }
  throw new Error('Yahoo Finance crumb unavailable (rate limited?)');
}

export async function getCookie(): Promise<string> {
  if (cookieCache && Date.now() - cookieCache.at < COOKIE_TTL_MS) return cookieCache.cookie;
  if (!cookiePending) {
    cookiePending = fetchCookie()
      .then((c) => { cookieCache = { cookie: c, at: Date.now() }; cookiePending = null; return c; })
      .catch((e: Error) => { cookiePending = null; throw e; });
  }
  return cookiePending;
}

export async function getCrumb(): Promise<string> {
  if (crumbCache && Date.now() - crumbCache.at < CRUMB_TTL_MS) return crumbCache.crumb;
  if (!crumbPending) {
    crumbPending = getCookie()
      .then(fetchCrumb)
      .then((c) => { crumbCache = { crumb: c, at: Date.now() }; crumbPending = null; return c; })
      .catch((e: Error) => { crumbPending = null; throw e; });
  }
  return crumbPending;
}

export function invalidateCookieCache(): void {
  cookieCache = null;
  crumbCache = null;
}

export function invalidateCrumbCache(): void {
  crumbCache = null;
}

/** GET a Yahoo Finance URL, automatically injecting cookie and crumb.
 *  First attempt uses cookie only (no crumb); on 401/403 it fetches crumb and retries. */
export async function yahooGet<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
  const cookie = await getCookie();
  const baseHeaders = {
    'User-Agent': YAHOO_UA,
    Accept: 'application/json',
    'Accept-Language': 'en-US,en;q=0.9',
    Referer: 'https://finance.yahoo.com/',
    Cookie: cookie,
  };

  // Attempt 1: no crumb
  try {
    const r = await axios.get<T>(url, { timeout: 10000, ...config, headers: { ...baseHeaders, ...config?.headers } });
    return r.data;
  } catch (err) {
    const status = (err as { response?: { status?: number } }).response?.status;
    if (status !== 401 && status !== 403) throw err;
    // fall through to crumb retry
  }

  // Attempt 2: with crumb
  const crumb = await getCrumb().catch(() => { throw new Error('Yahoo Finance session unavailable'); });
  const urlWithCrumb = url.includes('?')
    ? `${url}&crumb=${encodeURIComponent(crumb)}`
    : `${url}?crumb=${encodeURIComponent(crumb)}`;
  const r = await axios.get<T>(urlWithCrumb, { timeout: 10000, ...config, headers: { ...baseHeaders, ...config?.headers } });
  return r.data;
}
