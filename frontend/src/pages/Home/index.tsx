import { useLocation } from 'react-router-dom';
import { Typography } from 'antd';

export default function Home() {
  const { pathname } = useLocation();
  const hint =
    pathname.startsWith('/fund')
      ? '请从左侧搜索基金代码或名称'
      : '请从左侧收藏栏选择或搜索股票';

  return (
    <div style={{ padding: 24, color: '#999' }}>
      <Typography.Text type="secondary">{hint}</Typography.Text>
    </div>
  );
}
