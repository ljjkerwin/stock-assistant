import { create } from 'zustand';
import { message } from 'antd';
import type { WatchList, BoardType } from '../types';
import { watchListsApi } from '../api/stock';

function extractErrorMessage(error: unknown): string {
  const data = (error as { response?: { data?: { message?: string | string[] } } })?.response?.data;
  const msg = data?.message;
  if (Array.isArray(msg)) return msg.join('、') || '操作失败，请重试';
  return msg || '操作失败，请重试';
}

interface WatchListStore {
  stockLists: WatchList[];
  fundLists: WatchList[];
  currentStockListId: number | null;
  currentFundListId: number | null;
  fetchLists: (boardType: BoardType) => Promise<void>;
  createList: (name: string, boardType: BoardType) => Promise<WatchList | undefined>;
  deleteList: (id: number, boardType: BoardType) => Promise<void>;
  setCurrentList: (boardType: BoardType, id: number) => void;
}

function pickDefaultId(lists: WatchList[]): number | null {
  return lists.find((l) => l.isDefault)?.id ?? lists[0]?.id ?? null;
}

export const useWatchListStore = create<WatchListStore>((set, get) => ({
  stockLists: [],
  fundLists: [],
  currentStockListId: null,
  currentFundListId: null,

  fetchLists: async (boardType) => {
    try {
      const lists = await watchListsApi.list(boardType);
      if (boardType === 'stock') {
        const current = get().currentStockListId;
        const stillExists = current != null && lists.some((l) => l.id === current);
        set({ stockLists: lists, currentStockListId: stillExists ? current : pickDefaultId(lists) });
      } else {
        const current = get().currentFundListId;
        const stillExists = current != null && lists.some((l) => l.id === current);
        set({ fundLists: lists, currentFundListId: stillExists ? current : pickDefaultId(lists) });
      }
    } catch (error) {
      message.error(extractErrorMessage(error));
    }
  },

  createList: async (name, boardType) => {
    try {
      const created = await watchListsApi.create(name, boardType);
      if (boardType === 'stock') {
        set((s) => ({ stockLists: [...s.stockLists, created], currentStockListId: created.id }));
      } else {
        set((s) => ({ fundLists: [...s.fundLists, created], currentFundListId: created.id }));
      }
      return created;
    } catch (error) {
      message.error(extractErrorMessage(error));
      return undefined;
    }
  },

  deleteList: async (id, boardType) => {
    try {
      await watchListsApi.remove(id);
      if (boardType === 'stock') {
        set((s) => {
          const remaining = s.stockLists.filter((l) => l.id !== id);
          return {
            stockLists: remaining,
            currentStockListId: s.currentStockListId === id ? pickDefaultId(remaining) : s.currentStockListId,
          };
        });
      } else {
        set((s) => {
          const remaining = s.fundLists.filter((l) => l.id !== id);
          return {
            fundLists: remaining,
            currentFundListId: s.currentFundListId === id ? pickDefaultId(remaining) : s.currentFundListId,
          };
        });
      }
    } catch (error) {
      message.error(extractErrorMessage(error));
    }
  },

  setCurrentList: (boardType, id) => {
    if (boardType === 'stock') {
      set({ currentStockListId: id });
    } else {
      set({ currentFundListId: id });
    }
  },
}));
