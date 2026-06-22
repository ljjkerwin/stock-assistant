import { describe, it, expect, vi, beforeEach } from 'vitest';
import { message } from 'antd';
import { useWatchListStore } from './watchListStore';
import { watchListsApi } from '../api/stock';
import type { WatchList } from '../types';

vi.mock('../api/stock', () => ({
  watchListsApi: {
    list: vi.fn(),
    create: vi.fn(),
    remove: vi.fn(),
  },
}));

vi.mock('antd', async () => {
  const actual = await vi.importActual<typeof import('antd')>('antd');
  return {
    ...actual,
    message: { ...actual.message, error: vi.fn() },
  };
});

function createLocalStorageMock(): Storage {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => (key in store ? store[key] : null),
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    key: () => null,
    length: 0,
  };
}

vi.stubGlobal('localStorage', createLocalStorageMock());

describe('watchListStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useWatchListStore.setState({
      stockLists: [],
      fundLists: [],
      currentStockListId: null,
      currentFundListId: null,
    });
  });

  describe('fetchLists', () => {
    it('populates stockLists and selects the default list when no current selection', async () => {
      const lists: WatchList[] = [
        { id: 1, name: '我的自选股', boardType: 'stock', isDefault: false },
        { id: 2, name: '收藏夹', boardType: 'stock', isDefault: true },
      ];
      vi.mocked(watchListsApi.list).mockResolvedValue(lists);

      await useWatchListStore.getState().fetchLists('stock');

      const state = useWatchListStore.getState();
      expect(state.stockLists).toEqual(lists);
      expect(state.currentStockListId).toBe(2);
    });

    it('keeps the current selection if it still exists after refetch', async () => {
      useWatchListStore.setState({ currentStockListId: 1 });
      const lists: WatchList[] = [
        { id: 1, name: '我的自选股', boardType: 'stock', isDefault: false },
        { id: 2, name: '收藏夹', boardType: 'stock', isDefault: true },
      ];
      vi.mocked(watchListsApi.list).mockResolvedValue(lists);

      await useWatchListStore.getState().fetchLists('stock');

      expect(useWatchListStore.getState().currentStockListId).toBe(1);
    });

    it('dedupes concurrent calls for the same boardType into a single request', async () => {
      const lists: WatchList[] = [{ id: 2, name: '收藏夹', boardType: 'stock', isDefault: true }];
      vi.mocked(watchListsApi.list).mockResolvedValue(lists);

      const fetchLists = useWatchListStore.getState().fetchLists;
      await Promise.all([fetchLists('stock'), fetchLists('stock'), fetchLists('stock')]);

      expect(watchListsApi.list).toHaveBeenCalledTimes(1);

      // 上一批请求结束后再次调用应重新发请求
      await fetchLists('stock');
      expect(watchListsApi.list).toHaveBeenCalledTimes(2);
    });
  });

  describe('createList', () => {
    it('appends the new list and selects it as current', async () => {
      const created: WatchList = { id: 3, name: '打新观察', boardType: 'fund', isDefault: false };
      vi.mocked(watchListsApi.create).mockResolvedValue(created);

      const result = await useWatchListStore.getState().createList('打新观察', 'fund');

      expect(watchListsApi.create).toHaveBeenCalledWith('打新观察', 'fund');
      expect(result).toEqual(created);
      const state = useWatchListStore.getState();
      expect(state.fundLists).toEqual([created]);
      expect(state.currentFundListId).toBe(3);
    });

    it('shows an error message and resolves with undefined when the API call rejects', async () => {
      vi.mocked(watchListsApi.create).mockRejectedValue({
        response: { data: { message: '列表数量已达上限' } },
      });

      const result = await useWatchListStore.getState().createList('打新观察', 'fund');

      expect(result).toBeUndefined();
      expect(message.error).toHaveBeenCalledWith('列表数量已达上限');
      expect(useWatchListStore.getState().fundLists).toEqual([]);
    });
  });

  describe('deleteList', () => {
    it('removes the list and falls back to the default when the deleted list was selected', async () => {
      useWatchListStore.setState({
        stockLists: [
          { id: 1, name: '我的自选股', boardType: 'stock', isDefault: false },
          { id: 2, name: '收藏夹', boardType: 'stock', isDefault: true },
        ],
        currentStockListId: 1,
      });
      vi.mocked(watchListsApi.remove).mockResolvedValue(undefined);

      await useWatchListStore.getState().deleteList(1, 'stock');

      expect(watchListsApi.remove).toHaveBeenCalledWith(1);
      const state = useWatchListStore.getState();
      expect(state.stockLists).toEqual([{ id: 2, name: '收藏夹', boardType: 'stock', isDefault: true }]);
      expect(state.currentStockListId).toBe(2);
    });

    it('keeps the current selection when a different list is deleted', async () => {
      useWatchListStore.setState({
        stockLists: [
          { id: 1, name: '我的自选股', boardType: 'stock', isDefault: false },
          { id: 2, name: '收藏夹', boardType: 'stock', isDefault: true },
        ],
        currentStockListId: 2,
      });
      vi.mocked(watchListsApi.remove).mockResolvedValue(undefined);

      await useWatchListStore.getState().deleteList(1, 'stock');

      expect(useWatchListStore.getState().currentStockListId).toBe(2);
    });
  });

  describe('localStorage persistence', () => {
    it('setCurrentList saves the selection to localStorage', () => {
      useWatchListStore.getState().setCurrentList('stock', 1);

      expect(localStorage.getItem('watchList:current:stock')).toBe('1');
    });

    it('fetchLists restores the selection saved in localStorage after a page refresh', async () => {
      localStorage.setItem('watchList:current:stock', '1');
      const lists: WatchList[] = [
        { id: 1, name: '我的自选股', boardType: 'stock', isDefault: false },
        { id: 2, name: '收藏夹', boardType: 'stock', isDefault: true },
      ];
      vi.mocked(watchListsApi.list).mockResolvedValue(lists);

      await useWatchListStore.getState().fetchLists('stock');

      expect(useWatchListStore.getState().currentStockListId).toBe(1);
    });

    it('fetchLists saves the picked default id to localStorage when the saved id no longer exists', async () => {
      localStorage.setItem('watchList:current:stock', '99');
      const lists: WatchList[] = [{ id: 2, name: '收藏夹', boardType: 'stock', isDefault: true }];
      vi.mocked(watchListsApi.list).mockResolvedValue(lists);

      await useWatchListStore.getState().fetchLists('stock');

      expect(localStorage.getItem('watchList:current:stock')).toBe('2');
    });
  });
});
