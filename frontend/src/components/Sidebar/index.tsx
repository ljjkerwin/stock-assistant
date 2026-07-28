import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Button, Space, Typography, Select, Modal, Input, Dropdown } from 'antd';
import {
  DeleteOutlined,
  PushpinOutlined,
  PushpinFilled,
  ArrowUpOutlined,
  ArrowDownOutlined,
  PlusOutlined,
  LogoutOutlined,
  UserOutlined,
  EllipsisOutlined,
  EditOutlined,
  MailOutlined,
} from '@ant-design/icons';
import { useFavoritesStore } from '../../store/favoritesStore';
import { useWatchListStore } from '../../store/watchListStore';
import { useAuthStore } from '../../store/authStore';
import StockSearch from '../StockSearch';
import FundSearch from '../FundSearch';
import MonitorCenter from '../MonitorCenter';
import SmtpConfigModal from '../SmtpConfigModal';
import type { Stock, BoardType } from '../../types';
import styles from './Sidebar.module.css';

const { Text } = Typography;

const SECTION_OPTIONS = [
  { value: 'stock', label: '股票' },
  { value: 'klinegrid', label: '总览' },
  { value: 'darktrade-discovery', label: '明暗盘挖掘' },
  { value: 'fund', label: '基金' },
  { value: 'list', label: '股票列表导入' },
  { value: 'backtest', label: '策略回测' },
  { value: 'admin', label: '管理' },
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
    updateList,
    deleteList,
    setCurrentList,
  } = useWatchListStore();
  const username = useAuthStore((s) => s.user?.username);
  const logout = useAuthStore((s) => s.logout);
  const [addListOpen, setAddListOpen] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [creating, setCreating] = useState(false);

  const [renameListOpen, setRenameListOpen] = useState(false);
  const [renameListName, setRenameListName] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [smtpModalOpen, setSmtpModalOpen] = useState(false);

  const section = pathname.startsWith('/strategy-backtest')
    ? 'backtest'
    : pathname.startsWith('/admin')
      ? 'admin'
      : pathname.startsWith('/fund')
        ? 'fund'
        : pathname.startsWith('/stock-list-import')
          ? 'list'
    : pathname.startsWith('/stock-list-kline')
      ? 'klinegrid'
      : pathname.startsWith('/darktrade-discovery')
        ? 'darktrade-discovery'
      : 'stock';

  const boardType: BoardType | null =
    section === 'list' || section === 'darktrade-discovery'
      ? null
      : section === 'fund'
        ? 'fund'
        : 'stock';
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

  const moveItem = (list: Stock[], index: number, direction: 'top' | 'bottom') => {
    if (currentListId == null) return;
    const copy = [...list];
    const [item] = copy.splice(index, 1);
    if (direction === 'top') {
      copy.unshift(item);
    } else {
      copy.push(item);
    }
    reorder(currentListId, copy.map((f) => f.id!));
  };

  const handleSectionChange = (val: string) => {
    if (val === 'backtest') {
      navigate('/strategy-backtest');
    } else if (val === 'admin') {
      navigate('/admin');
    } else if (val === 'stock') {
      navigate('/stock');
    } else if (val === 'fund') {
      navigate('/fund');
    } else if (val === 'klinegrid') {
      navigate('/stock-list-kline');
    } else if (val === 'darktrade-discovery') {
      navigate('/darktrade-discovery');
    } else {
      navigate('/stock-list-import');
    }
  };

  const handleCreateList = async () => {
    if (!boardType || !newListName.trim() || creating) return;
    setCreating(true);
    try {
      await createList(newListName.trim(), boardType);
      setAddListOpen(false);
      setNewListName('');
    } catch (e) {
      console.error(e);
    } finally {
      setCreating(false);
    }
  };

  const handleRenameList = async () => {
    if (!currentList || !renameListName.trim() || renaming) return;
    setRenaming(true);
    try {
      await updateList(currentList.id, renameListName.trim(), boardType!);
      setRenameListOpen(false);
      setRenameListName('');
    } catch (e) {
      console.error(e);
    } finally {
      setRenaming(false);
    }
  };

  const handleDeleteList = () => {
    if (!currentList || !boardType) return;
    Modal.confirm({
      title: `确定删除列表「${currentList.name}」？`,
      content: `列表内的 ${items.length} 个标的也会被删除`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        await deleteList(currentList.id, boardType);
      },
    });
  };

  const menuProps = {
    items: [
      {
        key: 'rename',
        label: '修改列表名称',
        icon: <EditOutlined />,
        disabled: !currentList || currentList.isDefault,
      },
      {
        key: 'delete',
        label: '删除列表',
        icon: <DeleteOutlined />,
        danger: true,
        disabled: !currentList || currentList.isDefault,
      },
      {
        type: 'divider' as const,
      },
      {
        key: 'create',
        label: '新建列表',
        icon: <PlusOutlined />,
      },
    ],
    onClick: ({ key }: { key: string }) => {
      if (key === 'rename') {
        if (currentList) {
          setRenameListName(currentList.name);
          setRenameListOpen(true);
        }
      } else if (key === 'delete') {
        handleDeleteList();
      } else if (key === 'create') {
        setAddListOpen(true);
      }
    },
  };

  const userMenuProps = {
    items: [
      {
        key: 'smtp',
        label: '通知邮箱SMTP设置',
        icon: <MailOutlined />,
      },
      {
        type: 'divider' as const,
      },
      {
        key: 'logout',
        label: '退出登录',
        icon: <LogoutOutlined />,
        danger: true,
      },
    ],
    onClick: ({ key }: { key: string }) => {
      if (key === 'smtp') {
        setSmtpModalOpen(true);
      } else if (key === 'logout') {
        logout();
      }
    },
  };

  const renderItem = (stock: Stock, index: number, list: Stock[], urlFn: (s: Stock) => string) => (
    <div
      key={stock.id}
      className={`${styles.item} ${stock.pinned ? styles.pinnedItem : ''} ${pathname === urlFn(stock) ? styles.selected : ''
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
      <div className={styles.actions} onClick={(e) => e.stopPropagation()}>
        <Dropdown
          menu={{
            items: [
              {
                key: 'pin',
                label: stock.pinned ? '取消置顶' : '置顶',
                icon: stock.pinned ? <PushpinFilled /> : <PushpinOutlined />,
              },
              {
                key: 'top',
                label: '移到最前',
                icon: <ArrowUpOutlined />,
                disabled: index === 0,
              },
              {
                key: 'bottom',
                label: '移到最后',
                icon: <ArrowDownOutlined />,
                disabled: index === list.length - 1,
              },
              {
                key: 'delete',
                label: '删除',
                icon: <DeleteOutlined />,
                danger: true,
              },
            ],
            onClick: ({ domEvent, key }) => {
              domEvent.stopPropagation();
              if (key === 'pin') {
                if (currentListId != null) pin(stock.id!, currentListId, !stock.pinned);
              } else if (key === 'top') {
                moveItem(list, index, 'top');
              } else if (key === 'bottom') {
                moveItem(list, index, 'bottom');
              } else if (key === 'delete') {
                if (currentListId != null) removeItem(stock.id!, currentListId);
              }
            },
          }}
          trigger={['click']}
          placement="bottomRight"
        >
          <Button
            type="text"
            size="small"
            icon={<EllipsisOutlined />}
          />
        </Dropdown>
      </div>
    </div>
  );

  const visibleOptions = SECTION_OPTIONS.filter((opt) => {
    if (username === 'ljj') return true;
    return opt.value === 'stock' || opt.value === 'klinegrid' || opt.value === 'darktrade-discovery' || opt.value === 'fund';
  });

  return (
    <div className={styles.sidebar}>
      <div className={styles.sectionSelect}>
        <span>页面：</span>
        <Select
          value={section}
          options={visibleOptions}
          onChange={(val) => handleSectionChange(val)}
          style={{ width: '100%' }}
        />
      </div>

      {boardType && (
        <div className={styles.listSwitcher}>
          <Select
            value={currentListId ?? undefined}
            options={lists.map((l) => ({ value: l.id, label: l.name }))}
            onChange={(id) => setCurrentList(boardType, id)}
            style={{ flex: 1 }}
            size="small"
          />

          <Dropdown menu={menuProps} trigger={['click']} placement="bottomRight">
            <Button
              type="text"
              size="small"
              icon={<EllipsisOutlined />}
            />
          </Dropdown>
        </div>
      )}

      {section !== 'list' && section !== 'darktrade-discovery' && (
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

      <div className={styles.userBar}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Dropdown menu={userMenuProps} trigger={['click']} placement="topLeft">
            <span className={styles.usernameDropdown}>
              <UserOutlined /> {username}
            </span>
          </Dropdown>
        </div>
        <Space size={4}>
          <MonitorCenter />
        </Space>
      </div>

      <Modal
        title="新建列表"
        open={addListOpen}
        onCancel={() => {
          if (creating) return;
          setAddListOpen(false);
          setNewListName('');
        }}
        onOk={handleCreateList}
        confirmLoading={creating}
        okButtonProps={{ disabled: !newListName.trim() || creating }}
        okText="创建"
        cancelText="取消"
      >
        <Input
          placeholder="请输入列表名称"
          value={newListName}
          onChange={(e) => setNewListName(e.target.value)}
          onPressEnter={handleCreateList}
          disabled={creating}
          autoFocus
        />
      </Modal>

      <Modal
        title="修改列表名称"
        open={renameListOpen}
        onCancel={() => {
          if (renaming) return;
          setRenameListOpen(false);
          setRenameListName('');
        }}
        onOk={handleRenameList}
        confirmLoading={renaming}
        okButtonProps={{ disabled: !renameListName.trim() || renaming || renameListName.trim() === currentList?.name }}
        okText="保存"
        cancelText="取消"
      >
        <Input
          placeholder="请输入列表名称"
          value={renameListName}
          onChange={(e) => setRenameListName(e.target.value)}
          onPressEnter={handleRenameList}
          disabled={renaming}
          autoFocus
        />
      </Modal>

      <SmtpConfigModal
        open={smtpModalOpen}
        onCancel={() => setSmtpModalOpen(false)}
      />
    </div>
  );
}
