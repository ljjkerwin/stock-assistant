import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Button, Tooltip, Space, Typography, Select, Modal, Input, Popconfirm } from 'antd';
import {
  DeleteOutlined,
  PushpinOutlined,
  PushpinFilled,
  ArrowUpOutlined,
  ArrowDownOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import { useFavoritesStore } from '../../store/favoritesStore';
import { useWatchListStore } from '../../store/watchListStore';
import StockSearch from '../StockSearch';
import FundSearch from '../FundSearch';
import type { Stock, BoardType } from '../../types';
import styles from './Sidebar.module.css';

const { Text } = Typography;

const SECTION_OPTIONS = [
  { value: 'stock', label: '股票' },
  { value: 'backtest', label: '策略回测' },
  { value: 'klinegrid', label: 'K线总览' },
  { value: 'fund', label: '基金' },
  { value: 'list', label: '股票列表导入' },
];

export default function Sidebar() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { itemsByList, fetchList, removeItem, pin, reorder } = useFavoritesStore();
  const {
    stockLists,
    fundLists,
    currentStockListId,
    currentFundListId,
    fetchLists,
    createList,
    deleteList,
    setCurrentList,
  } = useWatchListStore();
  const [addListOpen, setAddListOpen] = useState(false);
  const [newListName, setNewListName] = useState('');

  const section = pathname.startsWith('/strategy-backtest')
    ? 'backtest'
    : pathname.startsWith('/fund')
      ? 'fund'
      : pathname.startsWith('/stock-list-import')
        ? 'list'
        : pathname.startsWith('/stock-list-kline')
          ? 'klinegrid'
          : 'stock';

  const boardType: BoardType | null = section === 'list' ? null : section === 'fund' ? 'fund' : 'stock';
  const lists = boardType === 'fund' ? fundLists : stockLists;
  const currentListId = boardType === 'fund' ? currentFundListId : currentStockListId;
  const currentList = lists.find((l) => l.id === currentListId) ?? null;
  const items = currentListId != null ? itemsByList[currentListId] ?? [] : [];

  useEffect(() => {
    if (boardType) fetchLists(boardType);
  }, [boardType, fetchLists]);

  useEffect(() => {
    if (currentListId != null) fetchList(currentListId);
  }, [currentListId, fetchList]);

  const moveItem = (list: Stock[], index: number, direction: 'up' | 'down') => {
    if (currentListId == null) return;
    const copy = [...list];
    const target = direction === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= copy.length) return;
    [copy[index], copy[target]] = [copy[target], copy[index]];
    reorder(currentListId, copy.map((f) => f.id!));
  };

  const handleSectionChange = (val: string) => {
    if (val === 'backtest') {
      navigate('/strategy-backtest');
    } else if (val === 'stock') {
      navigate('/stock');
    } else if (val === 'fund') {
      navigate('/fund');
    } else if (val === 'klinegrid') {
      navigate('/stock-list-kline');
    } else {
      navigate('/stock-list-import');
    }
  };

  const handleCreateList = async () => {
    if (!boardType || !newListName.trim()) return;
    await createList(newListName.trim(), boardType);
    setAddListOpen(false);
    setNewListName('');
  };

  const renderItem = (stock: Stock, index: number, list: Stock[], urlFn: (s: Stock) => string) => (
    <div
      key={stock.id}
      className={`${styles.item} ${stock.pinned ? styles.pinnedItem : ''} ${
        pathname === urlFn(stock) ? styles.selected : ''
      }`}
      onClick={() => navigate(urlFn(stock))}
    >
      <div className={styles.stockInfo}>
        <div className={styles.nameRow}>
          {stock.pinned && <PushpinFilled className={styles.pinIcon} />}
          <Text strong className={styles.name}>{stock.name}</Text>
        </div>
        <Text type="secondary" className={styles.code}>
          {stock.code} · {stock.market === 'HK' ? '港股' : stock.market === 'FUND' ? '基金' : 'A股'}
        </Text>
      </div>
      <Space size={0} className={styles.actions} onClick={(e) => e.stopPropagation()}>
        <Tooltip title={stock.pinned ? '取消置顶' : '置顶'}>
          <Button
            type="text"
            size="small"
            icon={stock.pinned ? <PushpinFilled /> : <PushpinOutlined />}
            onClick={() => currentListId != null && pin(stock.id!, currentListId, !stock.pinned)}
          />
        </Tooltip>
        <Tooltip title="上移">
          <Button
            type="text"
            size="small"
            icon={<ArrowUpOutlined />}
            disabled={index === 0}
            onClick={() => moveItem(list, index, 'up')}
          />
        </Tooltip>
        <Tooltip title="下移">
          <Button
            type="text"
            size="small"
            icon={<ArrowDownOutlined />}
            disabled={index === list.length - 1}
            onClick={() => moveItem(list, index, 'down')}
          />
        </Tooltip>
        <Tooltip title="删除">
          <Button
            type="text"
            size="small"
            danger
            icon={<DeleteOutlined />}
            onClick={() => currentListId != null && removeItem(stock.id!, currentListId)}
          />
        </Tooltip>
      </Space>
    </div>
  );

  return (
    <div className={styles.sidebar}>
      <div className={styles.sectionSelect}>
        <Select
          value={section}
          options={SECTION_OPTIONS}
          onChange={(val) => handleSectionChange(val)}
          style={{ width: '100%' }}
        />
      </div>

      {boardType && (
        <div className={styles.listSwitcher}>
          <Tooltip title="新建列表">
            <Button
              type="text"
              size="small"
              icon={<PlusOutlined />}
              onClick={() => setAddListOpen(true)}
            />
          </Tooltip>
          
          <Select
            value={currentListId ?? undefined}
            options={lists.map((l) => ({ value: l.id, label: l.name }))}
            onChange={(id) => setCurrentList(boardType, id)}
            style={{ flex: 1 }}
            size="small"
          />

          {currentList && !currentList.isDefault && (
            <Popconfirm
              title={`确定删除列表「${currentList.name}」？`}
              description={`列表内的 ${items.length} 个标的也会被删除`}
              onConfirm={() => deleteList(currentList.id, boardType)}
              okText="删除"
              okButtonProps={{ danger: true }}
              cancelText="取消"
            >
              <Tooltip title="删除列表">
                <Button type="text" size="small" danger icon={<DeleteOutlined />} />
              </Tooltip>
            </Popconfirm>
          )}
        </div>
      )}

      {section !== 'list' && section !== 'klinegrid' && (
        <div className={styles.search}>
          {section === 'fund' ? (
            <FundSearch size="middle" />
          ) : (
            <StockSearch
              size="middle"
              onSelect={
                section === 'backtest'
                  ? (stock) => navigate(`/strategy-backtest/${stock.code}`)
                  : undefined
              }
            />
          )}
        </div>
      )}

      {(section === 'stock' || section === 'backtest' || section === 'klinegrid') && (
        <div className={styles.list}>
          {items.map((stock, index) =>
            renderItem(
              stock,
              index,
              items,
              section === 'backtest'
                ? (s) => `/strategy-backtest/${s.code}`
                : (s) => `/stock/${s.market}/${s.code}`,
            ),
          )}
        </div>
      )}

      {section === 'fund' && (
        <div className={styles.list}>
          {items.map((stock, index) => renderItem(stock, index, items, (s) => `/fund/${s.code}`))}
        </div>
      )}

      <Modal
        title="新建列表"
        open={addListOpen}
        onCancel={() => {
          setAddListOpen(false);
          setNewListName('');
        }}
        onOk={handleCreateList}
        okButtonProps={{ disabled: !newListName.trim() }}
        okText="创建"
        cancelText="取消"
      >
        <Input
          placeholder="请输入列表名称"
          value={newListName}
          onChange={(e) => setNewListName(e.target.value)}
          onPressEnter={handleCreateList}
          autoFocus
        />
      </Modal>
    </div>
  );
}
