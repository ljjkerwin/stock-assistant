import axios, { AxiosRequestConfig } from 'axios';

const YAHOO_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: '*/*',
  Origin: 'https://finance.yahoo.com',
  Referer: 'https://finance.yahoo.com/',
};

export async function yahooGet<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
  const r = await axios.get<T>(url, {
    timeout: 10000,
    ...config,
    headers: { ...YAHOO_HEADERS, ...config?.headers },
  });
  return r.data;
}
