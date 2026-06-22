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

function storageKey(boardType: BoardType): string {
  return `watchList:current:${boardType}`;
}

function getSavedCurrentId(boardType: BoardType): number | null {
  try {
    const raw = localStorage.getItem(storageKey(boardType));
    const id = raw == null ? NaN : Number(raw);
    return Number.isFinite(id) ? id : null;
  } catch {
    return null;
  }
}

function saveCurrentId(boardType: BoardType, id: number | null): void {
  try {
    if (id == null) {
      localStorage.removeItem(storageKey(boardType));
    } else {
      localStorage.setItem(storageKey(boardType), String(id));
    }
  } catch (error) {
    console.warn('保存标的列表选择失败', error);
  }
}

// 同一 boardType 的进行中请求去重：多个组件（Sidebar / 详情页 / AddToListMenu）
// 同一渲染周期内并发调用 fetchLists 时，复用同一个 promise，避免重复打接口
const inflight: Partial<Record<BoardType, Promise<void>>> = {};

export const useWatchListStore = create<WatchListStore>((set, get) => ({
  stockLists: [],
  fundLists: [],
  currentStockListId: null,
  currentFundListId: null,

  fetchLists: (boardType) => {
    const existing = inflight[boardType];
    if (existing) return existing;

    const promise = (async () => {
      try {
        const lists = await watchListsApi.list(boardType);
        const current = (boardType === 'stock' ? get().currentStockListId : get().currentFundListId) ?? getSavedCurrentId(boardType);
        const stillExists = current != null && lists.some((l) => l.id === current);
        const nextId = stillExists ? current : pickDefaultId(lists);
        if (boardType === 'stock') {
          set({ stockLists: lists, currentStockListId: nextId });
        } else {
          set({ fundLists: lists, currentFundListId: nextId });
        }
        saveCurrentId(boardType, nextId);
      } catch (error) {
        message.error(extractErrorMessage(error));
      } finally {
        delete inflight[boardType];
      }
    })();

    inflight[boardType] = promise;
    return promise;
  },

  createList: async (name, boardType) => {
    try {
      const created = await watchListsApi.create(name, boardType);
      if (boardType === 'stock') {
        set((s) => ({ stockLists: [...s.stockLists, created], currentStockListId: created.id }));
      } else {
        set((s) => ({ fundLists: [...s.fundLists, created], currentFundListId: created.id }));
      }
      saveCurrentId(boardType, created.id);
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
          const nextId = s.currentStockListId === id ? pickDefaultId(remaining) : s.currentStockListId;
          saveCurrentId(boardType, nextId);
          return { stockLists: remaining, currentStockListId: nextId };
        });
      } else {
        set((s) => {
          const remaining = s.fundLists.filter((l) => l.id !== id);
          const nextId = s.currentFundListId === id ? pickDefaultId(remaining) : s.currentFundListId;
          saveCurrentId(boardType, nextId);
          return { fundLists: remaining, currentFundListId: nextId };
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
    saveCurrentId(boardType, id);
  },
}));
