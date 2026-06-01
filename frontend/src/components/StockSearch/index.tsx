import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { AutoComplete, Input, Spin } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { stocksApi } from '../../api/stock';
import type { Stock } from '../../types';

interface Option {
  value: string;
  label: string;
  stock: Stock;
}

interface Props {
  size?: 'small' | 'middle' | 'large';
}

export default function StockSearch({ size = 'middle' }: Props) {
  const [options, setOptions] = useState<Option[]>([]);
  const [loading, setLoading] = useState(false);
  const queryRef = useRef('');
  const navigate = useNavigate();

  const doSearch = async () => {
    const q = queryRef.current;
    if (!q.trim()) {
      setOptions([]);
      return;
    }
    setLoading(true);
    try {
      const results = await stocksApi.search(q);
      setOptions(
        results.map((r) => ({
          value: `${r.market}:${r.code}`,
          label: `${r.name} (${r.code}) ${r.market === 'HK' ? '港股' : 'A股'}`,
          stock: r,
        })),
      );
    } catch {
      setOptions([]);
    } finally {
      setLoading(false);
    }
  };

  const onSearch = (q: string) => {
    queryRef.current = q;
    setOptions([]);
  };

  const onSelect = (_value: string, option: Option) => {
    navigate(`/stock/${option.stock.market}/${option.stock.code}`);
  };

  return (
    <AutoComplete
      options={options}
      onSearch={onSearch}
      onSelect={onSelect}
      style={{ width: '100%' }}
    >
      <Input
        size={size}
        variant="borderless"
        prefix={<SearchOutlined />}
        suffix={loading ? <Spin size="small" /> : null}
        placeholder="搜索股票代码/名称"
        onPressEnter={doSearch}
      />
    </AutoComplete>
  );
}
