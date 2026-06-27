// 脚本共用的登录鉴权助手。
//
// 后端加了全局 AuthGuard 后，除 /api/auth/login 外所有 /api/* 都需带令牌，
// 否则返回 401。各脚本调用 authHeaders(BASE) 取一次令牌（按 base 缓存、整个进程
// 只登录一次），把返回的 header 合并进 fetch 即可。
//
// 账号：默认内置账号 ljj / asdfasdf，可用环境变量 AUTH_USER / AUTH_PASS 覆盖。

const USER = process.env.AUTH_USER || 'ljj';
const PASS = process.env.AUTH_PASS || 'asdfasdf';

const cache = new Map(); // base -> { Authorization }

export async function authHeaders(base) {
  if (!cache.has(base)) {
    const r = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: USER, password: PASS }),
    });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      throw new Error(
        `登录失败 HTTP ${r.status} ${body.slice(0, 120)}（账号默认 ljj/asdfasdf，可用 AUTH_USER/AUTH_PASS 覆盖）`,
      );
    }
    const { token } = await r.json();
    cache.set(base, { Authorization: `Bearer ${token}` });
  }
  return cache.get(base);
}
