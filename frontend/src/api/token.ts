/** 登录令牌的本地存取，集中一处以避免 api 层与 store 层互相 import 形成环。 */
const TOKEN_KEY = 'auth:token';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* 忽略隐私模式等存储失败 */
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* 忽略 */
  }
}

/** 令牌失效（401）时由 axios 拦截器派发，authStore 监听后回到登录态。 */
export const AUTH_LOGOUT_EVENT = 'auth:logout';

/** 「记住密码」勾选时持久化登录表单的用户名/密码，供下次进入登录页预填。 */
const REMEMBER_KEY = 'auth:remember';

export interface RememberedCredentials {
  username: string;
  password: string;
}

export function getRememberedCredentials(): RememberedCredentials | null {
  try {
    const raw = localStorage.getItem(REMEMBER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RememberedCredentials>;
    if (typeof parsed.username !== 'string' || typeof parsed.password !== 'string') return null;
    return { username: parsed.username, password: parsed.password };
  } catch {
    return null;
  }
}

export function setRememberedCredentials(creds: RememberedCredentials): void {
  try {
    localStorage.setItem(REMEMBER_KEY, JSON.stringify(creds));
  } catch {
    /* 忽略隐私模式等存储失败 */
  }
}

export function clearRememberedCredentials(): void {
  try {
    localStorage.removeItem(REMEMBER_KEY);
  } catch {
    /* 忽略 */
  }
}
