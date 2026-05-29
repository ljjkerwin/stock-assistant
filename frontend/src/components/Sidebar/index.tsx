import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Button, Tooltip, Space, Typography, Segmented } from 'antd';
import {
  DeleteOutlined,
  PushpinOutlined,
  PushpinFilled,
  ArrowUpOutlined,
  ArrowDownOutlined,
} from '@ant-design/icons';
import { useFavoritesStore } from '../../store/favoritesStore';
import StockSearch from '../StockSearch';
import FundSearch from '../FundSearch';
import type { Stock } from '../../types';
import styles from './Sidebar.module.css';

const { Text } = Typography;

const SECTION_OPTIONS = [
  { value: 'stock', label: '股票' },
  { value: 'fund', label: '基金' },
] as const;

export default function Sidebar() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { favorites, fetchFavorites, removeStock, pinStock, reorderStocks } =
    useFavoritesStore();

  const section = pathname.startsWith('/fund') ? 'fund' : 'stock';

  useEffect(() => {
    fetchFavorites();
  }, [fetchFavorites]);

  const moveItem = (index: number, direction: 'up' | 'down') => {
    const list = [...favorites];
    const target = direction === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= list.length) return;
    [list[index], list[target]] = [list[target], list[index]];
    reorderStocks(list.map((f) => f.id!));
  };

  const handleSectionChange = (val: string) => {
    if (val === 'stock') navigate('/stock');
    else navigate('/fund');
  };

  return (
    <div className={styles.sidebar}>
      <div className={styles.sectionSelect}>
        <Segmented
          value={section}
          options={SECTION_OPTIONS}
          onChange={(val) => handleSectionChange(val as string)}
          block
        />
      </div>

      <div className={styles.search}>
        {section === 'stock' ? <StockSearch size="middle" /> : <FundSearch size="middle" />}
      </div>

      {section === 'stock' && (
        <div>
          {favorites.map((stock: Stock, index) => (
            <div
              key={stock.id}
              className={`${styles.item} ${pathname === `/stock/${stock.market}/${stock.code}` ? styles.selected : ''}`}
              onClick={() => navigate(`/stock/${stock.market}/${stock.code}`)}
            >
              <div className={styles.stockInfo}>
                <Text strong className={styles.name}>{stock.name}</Text>
                <Text type="secondary" className={styles.code}>
                  {stock.code} · {stock.market === 'HK' ? '港股' : 'A股'}
                </Text>
              </div>
              <Space size={0} className={styles.actions} onClick={(e) => e.stopPropagation()}>
                <Tooltip title={stock.pinned ? '取消置顶' : '置顶'}>
                  <Button
                    type="text"
                    size="small"
                    icon={stock.pinned ? <PushpinFilled /> : <PushpinOutlined />}
                    onClick={() => pinStock(stock.id!, !stock.pinned)}
                  />
                </Tooltip>
                <Tooltip title="上移">
                  <Button
                    type="text"
                    size="small"
                    icon={<ArrowUpOutlined />}
                    disabled={index === 0}
                    onClick={() => moveItem(index, 'up')}
                  />
                </Tooltip>
                <Tooltip title="下移">
                  <Button
                    type="text"
                    size="small"
                    icon={<ArrowDownOutlined />}
                    disabled={index === favorites.length - 1}
                    onClick={() => moveItem(index, 'down')}
                  />
                </Tooltip>
                <Tooltip title="删除">
                  <Button
                    type="text"
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => removeStock(stock.id!)}
                  />
                </Tooltip>
              </Space>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
