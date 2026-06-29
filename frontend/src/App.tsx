import { useEffect } from 'react';
import { ConfigProvider, Spin } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import Login from './pages/Login';
import Sidebar from './components/Sidebar';
import Home from './pages/Home';
import StockDetail from './pages/StockDetail';
import FundDetail from './pages/FundDetail';
import StockListImport from './pages/StockListImport';
import StockListKline from './pages/StockListKline';
import StrategyBacktest from './pages/StrategyBacktest';
import MonitorCenter from './components/MonitorCenter';
import styles from './App.module.css';

export default function App() {
  const user = useAuthStore((s) => s.user);
  const initialized = useAuthStore((s) => s.initialized);
  const init = useAuthStore((s) => s.init);

  useEffect(() => {
    void init();
  }, [init]);

  if (!initialized) {
    return (
      <ConfigProvider locale={zhCN}>
        <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Spin size="large" />
        </div>
      </ConfigProvider>
    );
  }

  if (!user) {
    return (
      <ConfigProvider locale={zhCN}>
        <Login />
      </ConfigProvider>
    );
  }

  return (
    <ConfigProvider locale={zhCN}>
      <div className={styles.layout}>
        <aside className={styles.sidebar}>
          <Sidebar />
        </aside>
        <main className={styles.content}>
          <Routes>
            <Route path="/" element={<Navigate to="/stock" replace />} />
            <Route path="/stock" element={<Home />} />
            <Route path="/stock/:market/:code" element={<StockDetail />} />
            <Route path="/fund" element={<Home />} />
            <Route path="/fund/:code" element={<FundDetail />} />
            <Route path="/stock-list-import" element={<StockListImport />} />
            <Route path="/stock-list-kline" element={<StockListKline />} />
            <Route path="/strategy-backtest" element={<StrategyBacktest />} />
            <Route path="/strategy-backtest/:code" element={<StrategyBacktest />} />
          </Routes>
        </main>
      </div>
      <MonitorCenter />
    </ConfigProvider>
  );
}
