import { useEffect, useState, useRef } from 'react';
import { ConfigProvider, Spin, Button } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { MenuOutlined } from '@ant-design/icons';
import { useAuthStore } from './store/authStore';
import Login from './pages/Login';
import Sidebar from './components/Sidebar';
import Home from './pages/Home';
import StockDetail from './pages/StockDetail';
import FundDetail from './pages/FundDetail';
import StockListImport from './pages/StockListImport';
import StockListKline from './pages/StockListKline';
import StrategyBacktest from './pages/StrategyBacktest';
import styles from './App.module.css';

export default function App() {
  const user = useAuthStore((s) => s.user);
  const initialized = useAuthStore((s) => s.initialized);
  const init = useAuthStore((s) => s.init);
  const { pathname } = useLocation();
  const [sidebarVisible, setSidebarVisible] = useState(false);
  const [btnY, setBtnY] = useState(24);
  const dragStartRef = useRef<{ startY: number; startBtnY: number; hasMoved: boolean } | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    dragStartRef.current = {
      startY: touch.clientY,
      startBtnY: btnY,
      hasMoved: false,
    };
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!dragStartRef.current) return;
    const touch = e.touches[0];
    const deltaY = dragStartRef.current.startY - touch.clientY;
    
    if (Math.abs(deltaY) > 5) {
      dragStartRef.current.hasMoved = true;
    }
    
    const newY = dragStartRef.current.startBtnY + deltaY;
    const minY = 12;
    const maxY = window.innerHeight / 2;
    const clampedY = Math.max(minY, Math.min(maxY, newY));
    setBtnY(clampedY);
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (dragStartRef.current && dragStartRef.current.hasMoved) {
      e.preventDefault();
      e.stopPropagation();
    }
    dragStartRef.current = null;
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    dragStartRef.current = {
      startY: e.clientY,
      startBtnY: btnY,
      hasMoved: false,
    };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!dragStartRef.current) return;
      const deltaY = dragStartRef.current.startY - moveEvent.clientY;
      if (Math.abs(deltaY) > 5) {
        dragStartRef.current.hasMoved = true;
      }
      const newY = dragStartRef.current.startBtnY + deltaY;
      const minY = 12;
      const maxY = window.innerHeight / 2;
      const clampedY = Math.max(minY, Math.min(maxY, newY));
      setBtnY(clampedY);
    };

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      
      if (dragStartRef.current && dragStartRef.current.hasMoved) {
        setTimeout(() => {
          dragStartRef.current = null;
        }, 0);
      } else {
        dragStartRef.current = null;
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const handleBtnClick = () => {
    if (dragStartRef.current) return;
    setSidebarVisible(true);
  };

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    setSidebarVisible(false);
  }, [pathname]);

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
        <Button
          type="text"
          shape="circle"
          icon={<MenuOutlined />}
          onClick={handleBtnClick}
          onMouseDown={handleMouseDown}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          className={styles.menuToggle}
          style={{ bottom: `${btnY}px` }}
        />

        {sidebarVisible && (
          <div className={styles.overlay} onClick={() => setSidebarVisible(false)} />
        )}

        <aside className={`${styles.sidebar} ${sidebarVisible ? styles.sidebarVisible : ''}`}>
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
    </ConfigProvider>
  );
}
