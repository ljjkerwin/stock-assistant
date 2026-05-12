import { create } from 'zustand';
import type { MonitorRule, MonitorMessage } from '../types';
import { monitorApi } from '../api/stock';

interface MonitorStore {
  rules: MonitorRule[];
  messages: MonitorMessage[];
  fetchRules: () => Promise<void>;
  createRule: (body: {
    stockCode: string;
    stockMarket: 'A' | 'HK';
    stockName: string;
    type: string;
    targetPrice?: number;
    maPeriod?: string;
  }) => Promise<void>;
  deleteRule: (id: number) => Promise<void>;
  toggleRule: (id: number, active: boolean) => Promise<void>;
  fetchMessages: () => Promise<void>;
  /** SSE 推送到达时追加消息（read 默认 false） */
  pushMessage: (msg: Omit<MonitorMessage, 'read'>) => void;
  markAllRead: () => void;
  clearMessages: () => Promise<void>;
}

export const useMonitorStore = create<MonitorStore>((set, get) => ({
  rules: [],
  messages: [],

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

  fetchMessages: async () => {
    const msgs = await monitorApi.getMessages();
    set({ messages: msgs.map((m) => ({ ...m, read: false })) });
  },

  pushMessage: (msg) => {
    set((s) => ({ messages: [{ ...msg, read: false }, ...s.messages] }));
  },

  markAllRead: () => {
    set((s) => ({ messages: s.messages.map((m) => ({ ...m, read: true })) }));
  },

  clearMessages: async () => {
    await monitorApi.clearMessages();
    set({ messages: [] });
  },
}));
