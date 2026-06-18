import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useMonitorStore } from './monitorStore';
import { monitorApi } from '../api/stock';
import type { MonitorRule, MonitorMessage } from '../types';

// Mock the API module
vi.mock('../api/stock', () => {
  return {
    monitorApi: {
      getRules: vi.fn(),
      createRule: vi.fn(),
      deleteRule: vi.fn(),
      toggleRule: vi.fn(),
      getMessages: vi.fn(),
      getUnreadCount: vi.fn(),
      markMessagesRead: vi.fn(),
      clearMessages: vi.fn(),
    },
  };
});

describe('monitorStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset Zustand store state
    useMonitorStore.setState({
      rules: [],
      messages: [],
      messagesTotal: 0,
      messagesPage: 0,
      unreadCount: 0,
    });
  });

  describe('fetchRules', () => {
    it('fetches rules and updates state', async () => {
      const mockRules = [
        { id: 1, stockCode: '600519', stockMarket: 'A', stockName: '贵州茅台', type: 'price_above', targetPrice: 1500, active: true },
      ];
      vi.mocked(monitorApi.getRules).mockResolvedValue(mockRules as unknown as MonitorRule[]);

      await useMonitorStore.getState().fetchRules();

      expect(monitorApi.getRules).toHaveBeenCalledTimes(1);
      expect(useMonitorStore.getState().rules).toEqual(mockRules);
    });
  });

  describe('fetchMessages', () => {
    it('fetches page 1, marks unread messages as read, and fetches unread count', async () => {
      const mockMessages = [
        { id: 101, stockCode: '600519', stockName: '贵州茅台', type: 'price_above', currentPrice: 1510, targetValue: 1500, read: false, triggeredAt: Date.now() },
        { id: 102, stockCode: '00700', stockName: '腾讯控股', type: 'price_below', currentPrice: 370, targetValue: 380, read: true, triggeredAt: Date.now() },
      ];
      vi.mocked(monitorApi.getMessages).mockResolvedValue({ items: mockMessages, total: 2 } as unknown as { items: MonitorMessage[]; total: number });
      vi.mocked(monitorApi.markMessagesRead).mockResolvedValue(undefined);
      vi.mocked(monitorApi.getUnreadCount).mockResolvedValue({ count: 4 });

      await useMonitorStore.getState().fetchMessages(1);

      // Verify page 1 fetched
      expect(monitorApi.getMessages).toHaveBeenCalledWith(1);

      // Verify unread messages (id 101) were sent to markMessagesRead
      expect(monitorApi.markMessagesRead).toHaveBeenCalledWith([101]);

      // Verify local store updates unread messages to read: true
      const state = useMonitorStore.getState();
      expect(state.messages).toHaveLength(2);
      expect(state.messages[0].read).toBe(true);
      expect(state.messages[1].read).toBe(true);
      expect(state.messagesTotal).toBe(2);
      expect(state.messagesPage).toBe(1);

      // Verify it updated the unreadCount
      expect(monitorApi.getUnreadCount).toHaveBeenCalledTimes(1);
      expect(state.unreadCount).toBe(4);
    });

    it('appends messages when fetching page > 1', async () => {
      // Setup initial messages (Page 1)
      const initialMessages = [
        { id: 101, stockCode: '600519', stockName: '贵州茅台', type: 'price_above', currentPrice: 1510, targetValue: 1500, read: true, triggeredAt: Date.now() },
      ];
      useMonitorStore.setState({
        messages: initialMessages as unknown as MonitorMessage[],
        messagesTotal: 3,
        messagesPage: 1,
        unreadCount: 0,
      });

      // Mock page 2
      const page2Messages = [
        { id: 102, stockCode: '00700', stockName: '腾讯控股', type: 'price_below', currentPrice: 370, targetValue: 380, read: true, triggeredAt: Date.now() },
        { id: 103, stockCode: '000001', stockName: '平安银行', type: 'price_above', currentPrice: 12, targetValue: 11, read: true, triggeredAt: Date.now() },
      ];
      vi.mocked(monitorApi.getMessages).mockResolvedValue({ items: page2Messages, total: 3 } as unknown as { items: MonitorMessage[]; total: number });

      await useMonitorStore.getState().fetchMessages(2);

      const state = useMonitorStore.getState();
      expect(state.messages).toHaveLength(3);
      expect(state.messages[0].id).toBe(101); // remains first
      expect(state.messages[1].id).toBe(102); // appended
      expect(state.messages[2].id).toBe(103); // appended
      expect(state.messagesPage).toBe(2);
      expect(monitorApi.markMessagesRead).not.toHaveBeenCalled(); // no unread messages in page 2 mock
    });
  });

  describe('pushMessage', () => {
    it('appends a message to the top and increments unread count', () => {
      useMonitorStore.setState({
        messages: [{ id: 201, stockCode: 'A', read: true } as unknown as MonitorMessage],
        unreadCount: 2,
      });

      useMonitorStore.getState().pushMessage({ id: 202, stockCode: 'B' } as unknown as MonitorMessage);

      const state = useMonitorStore.getState();
      expect(state.unreadCount).toBe(3);
      expect(state.messages).toHaveLength(2);
      expect(state.messages[0]).toEqual({ id: 202, stockCode: 'B', read: false });
    });
  });
});
