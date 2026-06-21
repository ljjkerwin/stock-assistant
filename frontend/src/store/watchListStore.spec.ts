import { describe, it, expect, vi, beforeEach } from 'vitest';
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

describe('watchListStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
