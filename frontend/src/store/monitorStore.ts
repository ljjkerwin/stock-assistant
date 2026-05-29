import { create } from 'zustand';
import type { MonitorRule, MonitorMessage } from '../types';
import { monitorApi } from '../api/stock';

interface MonitorStore {
  rules: MonitorRule[];
  messages: MonitorMessage[];
  messagesTotal: number;
  messagesPage: number;
  unreadCount: number;
  fetchRules: () => Promise<void>;
  createRule: (body: {
    stockCode: string;
    stockMarket: 'A' | 'HK';
    stockName: string;
    type: string;
    targetPrice?: number;
    maPeriod?: string;
    klinePeriod?: string;
  }) => Promise<void>;
  deleteRule: (id: number) => Promise<void>;
  toggleRule: (id: number, active: boolean) => Promise<void>;
  /** page=1 替换列表，page>1 追加；加载完后自动将本页未读消息标记为已读 */
  fetchMessages: (page: number) => Promise<void>;
  fetchUnreadCount: () => Promise<void>;
  /** SSE 推送到达时，递增未读数并将消息追加到列表头部 */
  pushMessage: (msg: Omit<MonitorMessage, 'read'>) => void;
  clearMessages: () => Promise<void>;
}

export const useMonitorStore = create<MonitorStore>((set, get) => ({
  rules: [],
  messages: [],
  messagesTotal: 0,
  messagesPage: 0,
  unreadCount: 0,

  fetchRules: async () => {
    const rules = await monitorApi.getRules();
    set({ rules });
  },

  createRule: async (body) => {
    await monitorApi.createRule(body);
    await get().fetchRules();
  },

  deleteRule: async (id) => {
    await monitorApi.deleteRule(id);
    set((s) => ({ rules: s.rules.filter((r) => r.id !== id) }));
  },

  toggleRule: async (id, active) => {
    const updated = await monitorApi.toggleRule(id, active);
    set((s) => ({ rules: s.rules.map((r) => (r.id === id ? updated : r)) }));
  },

  fetchMessages: async (page) => {
    const { items, total } = await monitorApi.getMessages(page);

    const unreadIds = items.filter((m) => !m.read).map((m) => m.id);

    if (unreadIds.length > 0) {
      void monitorApi.markMessagesRead(unreadIds);
    }

    const readItems = unreadIds.length > 0
      ? items.map((m) => (m.read ? m : { ...m, read: true }))
      : items;
    if (page === 1) {
      set({ messages: readItems, messagesTotal: total, messagesPage: 1 });
    } else {
      set((s) => ({
        messages: [...s.messages, ...readItems],
        messagesTotal: total,
        messagesPage: page,
      }));
    }

    if (unreadIds.length > 0) {
      await get().fetchUnreadCount();
    }
  },

  fetchUnreadCount: async () => {
    const { count } = await monitorApi.getUnreadCount();
    set({ unreadCount: count });
  },

  pushMessage: (msg) => {
    set((s) => ({
      unreadCount: s.unreadCount + 1,
      messages: [{ ...msg, read: false }, ...s.messages],
    }));
  },

  clearMessages: async () => {
    await monitorApi.clearMessages();
    set({ messages: [], messagesTotal: 0, messagesPage: 0, unreadCount: 0 });
  },
}));
