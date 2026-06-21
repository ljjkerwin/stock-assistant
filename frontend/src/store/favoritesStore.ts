import { create } from 'zustand';
import type { Stock } from '../types';
import { favoritesApi } from '../api/stock';

interface FavoritesStore {
  itemsByList: Record<number, Stock[]>;
  fetchList: (watchListId: number) => Promise<void>;
  addToList: (
    watchListId: number,
    stock: { code: string; market: 'A' | 'HK' | 'FUND'; name: string },
  ) => Promise<void>;
  removeItem: (favoriteId: number, watchListId: number) => Promise<void>;
  reorder: (watchListId: number, orderedIds: number[]) => Promise<void>;
  pin: (favoriteId: number, watchListId: number, pinned: boolean) => Promise<void>;
}

export const useFavoritesStore = create<FavoritesStore>((set, get) => ({
  itemsByList: {},

  fetchList: async (watchListId) => {
    const items = await favoritesApi.list(watchListId);
    set((s) => ({ itemsByList: { ...s.itemsByList, [watchListId]: items } }));
  },

  addToList: async (watchListId, stock) => {
    await favoritesApi.add({ ...stock, watchListId });
    await get().fetchList(watchListId);
  },

  removeItem: async (favoriteId, watchListId) => {
    await favoritesApi.remove(favoriteId);
    set((s) => ({
      itemsByList: {
        ...s.itemsByList,
        [watchListId]: (s.itemsByList[watchListId] ?? []).filter((f) => f.id !== favoriteId),
      },
    }));
  },

  reorder: async (watchListId, orderedIds) => {
    await Promise.all(orderedIds.map((id, index) => favoritesApi.update(id, { sortOrder: index })));
    await get().fetchList(watchListId);
  },

  pin: async (favoriteId, watchListId, pinned) => {
    await favoritesApi.update(favoriteId, { pinned });
    await get().fetchList(watchListId);
  },
}));
