import { useState, useRef } from 'react';
import { AutoComplete, Input, message, Spin } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { stocksApi } from '../../api/stock';
import { useFavoritesStore } from '../../store/favoritesStore';
import type { Stock } from '../../types';
import debounce from './debounce';

interface Option {
  value: string;
  label: string;
  stock: Stock;
}

export default function StockSearch() {
  const [options, setOptions] = useState<Option[]>([]);
  const [loading, setLoading] = useState(false);
  const addStock = useFavoritesStore((s) => s.addStock);
  const favorites = useFavoritesStore((s) => s.favorites);

  const searchRef = useRef(
    debounce(async (q: string, onResult: (opts: Option[]) => void, onLoading: (v: boolean) => void) => {
      if (!q.trim()) {
        onResult([]);
        return;
      }
      onLoading(true);
      try {
        const results = await stocksApi.search(q);
        onResult(
          results.map((r) => ({
            value: `${r.market}:${r.code}`,
            label: `${r.name} (${r.code}) ${r.market === 'HK' ? '港股' : 'A股'}`,
            stock: r,
          })),
        );
      } catch {
        onResult([]);
      } finally {
        onLoading(false);
      }
    }, 400),
  );

  const onSearch = (q: string) => {
    searchRef.current(q, setOptions, setLoading);
  };

  const onSelect = async (_value: string, option: Option) => {
    const already = favorites.some(
      (f) => f.code === option.stock.code && f.market === option.stock.market,
    );
    if (already) {
      void message.info(`${option.stock.name} 已在收藏夹`);
      return;
    }
    await addStock({ code: option.stock.code, market: option.stock.market, name: option.stock.name });
    void message.success(`已添加 ${option.stock.name}`);
  };

  return (
    <AutoComplete
      options={options}
      onSearch={onSearch}
      onSelect={onSelect}
      style={{ width: '100%' }}
    >
      <Input
        prefix={<SearchOutlined />}
        suffix={loading ? <Spin size="small" /> : null}
        placeholder="搜索股票代码/名称"
      />
    </AutoComplete>
  );
}
