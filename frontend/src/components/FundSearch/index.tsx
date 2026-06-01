import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { AutoComplete, Input, Spin } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { fundApi } from '../../api/stock';
import type { FundSearchResult } from '../../types';

interface Option {
  value: string;
  label: string;
  fund: FundSearchResult;
}

interface Props {
  size?: 'small' | 'middle' | 'large';
}

export default function FundSearch({ size = 'middle' }: Props) {
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
      const results = await fundApi.search(q);
      setOptions(
        results.map((r) => ({
          value: r.code,
          label: `${r.name} (${r.code})${r.type ? ' · ' + r.type : ''}`,
          fund: r,
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
    navigate(`/fund/${option.fund.code}`);
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
        placeholder="搜索基金代码/名称"
        onPressEnter={doSearch}
      />
    </AutoComplete>
  );
}
