import { useEffect } from 'react';
import { useMonitorStore } from '../store/monitorStore';
import { getToken } from '../api/token';
import type { MonitorMessage } from '../types';

/**
 * 连接后端 SSE 流，监听规则触发事件并推入 monitorStore。
 * 应在全局唯一挂载（App.tsx 或 MonitorCenter）。
 */
export function useMonitorSSE(): void {
  const pushMessage = useMonitorStore((s) => s.pushMessage);

  useEffect(() => {
    // EventSource 不能自定义请求头，令牌通过 query 传给后端 AuthGuard
    const token = getToken();
    const es = new EventSource(`/api/monitor/events${token ? `?token=${encodeURIComponent(token)}` : ''}`);

    es.onmessage = (event: MessageEvent<string>) => {
      try {
        const msg = JSON.parse(event.data) as Omit<MonitorMessage, 'read'>;
        pushMessage(msg);
      } catch {
        /* 忽略格式错误的事件 */
      }
    };

    es.onerror = () => {
      // EventSource 会自动重连，无需额外处理
    };

    return () => es.close();
  }, [pushMessage]);
}
