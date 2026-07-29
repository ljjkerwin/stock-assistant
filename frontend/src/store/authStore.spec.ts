import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authApi } from '../api/stock';
import { getStoredAuthUser, getToken, setStoredAuthUser, setToken } from '../api/token';
import { useAuthStore } from './authStore';

vi.mock('../api/stock', () => ({
  authApi: {
    login: vi.fn(),
    me: vi.fn(),
  },
}));

function createLocalStorageMock(): Storage {
  let store: Record<string, string> = {};
  return {
    getItem: (key) => store[key] ?? null,
    setItem: (key, value) => {
      store[key] = value;
    },
    removeItem: (key) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    key: () => null,
    get length() {
      return Object.keys(store).length;
    },
  };
}

vi.stubGlobal('localStorage', createLocalStorageMock());

describe('authStore init', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useAuthStore.setState({ user: null, initialized: false });
  });

  it('keeps the persisted session when the backend is temporarily unavailable', async () => {
    const user = { id: 1, username: 'ljj' };
    setToken('valid-token');
    setStoredAuthUser(user);
    vi.mocked(authApi.me).mockRejectedValue({ response: { status: 502 } });

    await useAuthStore.getState().init();

    expect(getToken()).toBe('valid-token');
    expect(useAuthStore.getState()).toMatchObject({ user, initialized: true });
  });

  it('clears the persisted session only when the token is rejected with 401', async () => {
    setToken('expired-token');
    setStoredAuthUser({ id: 1, username: 'ljj' });
    vi.mocked(authApi.me).mockRejectedValue({ response: { status: 401 } });

    await useAuthStore.getState().init();

    expect(getToken()).toBeNull();
    expect(getStoredAuthUser()).toBeNull();
    expect(useAuthStore.getState()).toMatchObject({ user: null, initialized: true });
  });
});
