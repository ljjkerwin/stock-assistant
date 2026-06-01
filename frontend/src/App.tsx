import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { Routes, Route, Navigate } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import Home from './pages/Home';
import StockDetail from './pages/StockDetail';
import FundDetail from './pages/FundDetail';
import StockListImport from './pages/StockListImport';
import MonitorCenter from './components/MonitorCenter';
import styles from './App.module.css';

export default function App() {
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
          </Routes>
        </main>
      </div>
      <MonitorCenter />
    </ConfigProvider>
  );
}
