import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useFavoritesStore } from './favoritesStore';
import { favoritesApi } from '../api/stock';
import type { Stock } from '../types';

vi.mock('../api/stock', () => ({
  favoritesApi: {
    list: vi.fn(),
    add: vi.fn(),
    remove: vi.fn(),
    update: vi.fn(),
  },
}));

describe('favoritesStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useFavoritesStore.setState({ itemsByList: {} });
  });

  describe('fetchList', () => {
    it('fetches items for a list and caches them by watchListId', async () => {
      const items: Stock[] = [{ id: 1, code: '600000', market: 'A', name: '浦发银行' }];
      vi.mocked(favoritesApi.list).mockResolvedValue(items);

      await useFavoritesStore.getState().fetchList(7);

      expect(favoritesApi.list).toHaveBeenCalledWith(7);
      expect(useFavoritesStore.getState().itemsByList[7]).toEqual(items);
    });
  });

  describe('addToList', () => {
    it('posts the stock with the target watchListId then refetches that list', async () => {
      vi.mocked(favoritesApi.add).mockResolvedValue({
        id: 1,
        code: '600000',
        market: 'A',
        name: '浦发银行',
      } as Stock);
      vi.mocked(favoritesApi.list).mockResolvedValue([
        { id: 1, code: '600000', market: 'A', name: '浦发银行' },
      ]);

      await useFavoritesStore.getState().addToList(7, { code: '600000', market: 'A', name: '浦发银行' });

      expect(favoritesApi.add).toHaveBeenCalledWith({
        code: '600000',
        market: 'A',
        name: '浦发银行',
        watchListId: 7,
      });
      expect(useFavoritesStore.getState().itemsByList[7]).toHaveLength(1);
    });
  });

  describe('removeItem', () => {
    it('deletes the favorite and removes it from the cached list locally', async () => {
      useFavoritesStore.setState({
        itemsByList: {
          7: [
            { id: 1, code: '600000', market: 'A', name: '浦发银行' },
            { id: 2, code: '000001', market: 'A', name: '平安银行' },
          ],
        },
      });
      vi.mocked(favoritesApi.remove).mockResolvedValue(undefined as never);

      await useFavoritesStore.getState().removeItem(1, 7);

      expect(favoritesApi.remove).toHaveBeenCalledWith(1);
      expect(useFavoritesStore.getState().itemsByList[7]).toEqual([
        { id: 2, code: '000001', market: 'A', name: '平安银行' },
      ]);
    });
  });

  describe('reorder', () => {
    it('updates sortOrder for each id in order then refetches the list', async () => {
      vi.mocked(favoritesApi.update).mockResolvedValue({} as Stock);
      vi.mocked(favoritesApi.list).mockResolvedValue([]);

      await useFavoritesStore.getState().reorder(7, [3, 1, 2]);

      expect(favoritesApi.update).toHaveBeenCalledWith(3, { sortOrder: 0 });
      expect(favoritesApi.update).toHaveBeenCalledWith(1, { sortOrder: 1 });
      expect(favoritesApi.update).toHaveBeenCalledWith(2, { sortOrder: 2 });
      expect(favoritesApi.list).toHaveBeenCalledWith(7);
    });
  });

  describe('pin', () => {
    it('updates pinned status then refetches the list', async () => {
      vi.mocked(favoritesApi.update).mockResolvedValue({} as Stock);
      vi.mocked(favoritesApi.list).mockResolvedValue([
        { id: 1, code: '600000', market: 'A', name: '浦发银行', pinned: true },
      ]);

      await useFavoritesStore.getState().pin(1, 7, true);

      expect(favoritesApi.update).toHaveBeenCalledWith(1, { pinned: true });
      expect(favoritesApi.list).toHaveBeenCalledWith(7);
    });
  });
});
