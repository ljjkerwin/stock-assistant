import { useEffect, useState } from 'react';
import { Dropdown, Button, Checkbox, Space, Empty } from 'antd';
import { DownOutlined } from '@ant-design/icons';
import { useWatchListStore } from '../../store/watchListStore';
import { useFavoritesStore } from '../../store/favoritesStore';
import type { BoardType } from '../../types';

interface Props {
  boardType: BoardType;
  stock: { code: string; market: 'A' | 'HK' | 'FUND'; name: string };
}

export default function AddToListMenu({ boardType, stock }: Props) {
  const { stockLists, fundLists, fetchLists } = useWatchListStore();
  const { itemsByList, fetchList, addToList, removeItem } = useFavoritesStore();
  const [open, setOpen] = useState(false);

  const lists = (boardType === 'stock' ? stockLists : fundLists).filter((l) => !l.isDefault);

  useEffect(() => {
    fetchLists(boardType);
  }, [boardType, fetchLists]);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      lists.forEach((l) => {
        if (!itemsByList[l.id]) fetchList(l.id);
      });
    }
  };

  const toggle = (listId: number, checked: boolean) => {
    if (checked) {
      addToList(listId, stock);
    } else {
      const existing = (itemsByList[listId] ?? []).find(
        (f) => f.code === stock.code && f.market === stock.market,
      );
      if (existing?.id != null) removeItem(existing.id, listId);
    }
  };

  return (
    <Dropdown
      open={open}
      onOpenChange={handleOpenChange}
      trigger={['click']}
      popupRender={() => (
        <div
          style={{
            background: '#fff',
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            borderRadius: 8,
            padding: 8,
            minWidth: 180,
          }}
        >
          {lists.length === 0 ? (
            <Empty
              description="暂无自定义列表，可在侧边栏「+」新建"
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              style={{ margin: 8 }}
            />
          ) : (
            <Space direction="vertical" size={4} style={{ width: '100%' }}>
              {lists.map((l) => {
                const checked = (itemsByList[l.id] ?? []).some(
                  (f) => f.code === stock.code && f.market === stock.market,
                );
                return (
                  <Checkbox key={l.id} checked={checked} onChange={(e) => toggle(l.id, e.target.checked)}>
                    {l.name}
                  </Checkbox>
                );
              })}
            </Space>
          )}
        </div>
      )}
    >
      <Button type="text" icon={<DownOutlined />}>
        加入列表
      </Button>
    </Dropdown>
  );
}
