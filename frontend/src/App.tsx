import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { Routes, Route } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import Home from './pages/Home';
import StockDetail from './pages/StockDetail';
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
            <Route path="/" element={<Home />} />
            <Route path="/stock/:market/:code" element={<StockDetail />} />
          </Routes>
        </main>
      </div>
      <MonitorCenter />
    </ConfigProvider>
  );
}
