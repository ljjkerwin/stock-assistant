import { create } from 'zustand';
import type { Stock } from '../types';
import { favoritesApi } from '../api/stock';

interface FavoritesStore {
  favorites: Stock[];
  fetchFavorites: () => Promise<void>;
  addStock: (stock: { code: string; market: 'A' | 'HK' | 'FUND'; name: string }) => Promise<void>;
  removeStock: (id: number) => Promise<void>;
  reorderStocks: (orderedIds: number[]) => Promise<void>;
  pinStock: (id: number, pinned: boolean) => Promise<void>;
}

export const useFavoritesStore = create<FavoritesStore>((set, get) => ({
  favorites: [],

  fetchFavorites: async () => {
    const favorites = await favoritesApi.list();
    set({ favorites });
  },

  addStock: async (stock) => {
    await favoritesApi.add(stock);
    await get().fetchFavorites();
  },

  removeStock: async (id) => {
    await favoritesApi.remove(id);
    set((s) => ({ favorites: s.favorites.filter((f) => f.id !== id) }));
  },

  reorderStocks: async (orderedIds) => {
    await Promise.all(
      orderedIds.map((id, index) => favoritesApi.update(id, { sortOrder: index })),
    );
    await get().fetchFavorites();
  },

  pinStock: async (id, pinned) => {
    await favoritesApi.update(id, { pinned });
    await get().fetchFavorites();
  },
}));
