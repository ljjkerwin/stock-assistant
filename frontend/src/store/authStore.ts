import { create } from 'zustand';
import { authApi, type AuthUser } from '../api/stock';
import {
  getStoredAuthUser,
  getToken,
  setStoredAuthUser,
  setToken,
  clearToken,
  AUTH_LOGOUT_EVENT,
} from '../api/token';

interface AuthStore {
  user: AuthUser | null;
  /** 是否已完成首次「用已有令牌换取用户信息」的探测，gate 据此决定先展示 loading 还是登录页 */
  initialized: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  /** 应用启动时调用：有令牌则拉取当前用户，失败则回到未登录态 */
  init: () => Promise<void>;
}

export function isUnauthorizedError(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('response' in error)) return false;
  const response = (error as { response?: { status?: unknown } }).response;
  return response?.status === 401;
}

export const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  initialized: false,

  login: async (username, password) => {
    const { token, user } = await authApi.login(username, password);
    setToken(token);
    setStoredAuthUser(user);
    set({ user, initialized: true });
  },

  logout: () => {
    clearToken();
    set({ user: null });
  },

  init: async () => {
    if (!getToken()) {
      set({ user: null, initialized: true });
      return;
    }
    try {
      const user = await authApi.me();
      set({ user, initialized: true });
    } catch (error: unknown) {
      // 仅 401 代表令牌已失效。502/网络错误通常是开发服务或数据库暂时不可用，
      // 此时保留会话，避免后端恢复后还需要重新登录。
      if (isUnauthorizedError(error)) {
        clearToken();
        set({ user: null, initialized: true });
        return;
      }
      set({ user: getStoredAuthUser(), initialized: true });
    }
  },
}));

// 令牌失效时（axios 拦截器派发）退回登录态
if (typeof window !== 'undefined') {
  window.addEventListener(AUTH_LOGOUT_EVENT, () => {
    useAuthStore.setState({ user: null });
  });
}
