import { create } from 'zustand';
import { message } from 'antd';
import type { Stock } from '../types';
import { favoritesApi } from '../api/stock';

function extractErrorMessage(error: unknown): string {
  const data = (error as { response?: { data?: { message?: string | string[] } } })?.response?.data;
  const msg = data?.message;
  if (Array.isArray(msg)) return msg.join('、') || '操作失败，请重试';
  return msg || '操作失败，请重试';
}

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

// 同一列表正在进行中的请求，用于合并并发的重复拉取（如侧边栏与详情页在挂载时
// 同时请求同一收藏列表），避免对 /api/favorites 重复发起请求。
const inFlight = new Map<number, Promise<void>>();

export const useFavoritesStore = create<FavoritesStore>((set, get) => ({
  itemsByList: {},

  fetchList: async (watchListId) => {
    const pending = inFlight.get(watchListId);
    if (pending) return pending;
    const request = favoritesApi
      .list(watchListId)
      .then((items) => {
        set((s) => ({ itemsByList: { ...s.itemsByList, [watchListId]: items } }));
      })
      .finally(() => {
        inFlight.delete(watchListId);
      });
    inFlight.set(watchListId, request);
    return request;
  },

  addToList: async (watchListId, stock) => {
    try {
      await favoritesApi.add({ ...stock, watchListId });
      await get().fetchList(watchListId);
    } catch (error) {
      message.error(extractErrorMessage(error));
    }
  },

  removeItem: async (favoriteId, watchListId) => {
    try {
      await favoritesApi.remove(favoriteId);
      set((s) => ({
        itemsByList: {
          ...s.itemsByList,
          [watchListId]: (s.itemsByList[watchListId] ?? []).filter((f) => f.id !== favoriteId),
        },
      }));
    } catch (error) {
      message.error(extractErrorMessage(error));
    }
  },

  reorder: async (watchListId, orderedIds) => {
    try {
      await Promise.all(orderedIds.map((id, index) => favoritesApi.update(id, { sortOrder: index })));
      await get().fetchList(watchListId);
    } catch (error) {
      message.error(extractErrorMessage(error));
    }
  },

  pin: async (favoriteId, watchListId, pinned) => {
    try {
      await favoritesApi.update(favoriteId, { pinned });
      await get().fetchList(watchListId);
    } catch (error) {
      message.error(extractErrorMessage(error));
    }
  },
}));
