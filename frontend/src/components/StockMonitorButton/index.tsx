import { useState } from 'react';
import { Badge, Button, Empty, Form, InputNumber, Modal, Select, Tooltip, Tag, Typography } from 'antd';
import { BellOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useMonitorStore } from '../../store/monitorStore';
import type { MaPeriod, MonitorType } from '../../types';

const TYPE_OPTIONS = [
  { value: 'price_above', label: '突破指定价格' },
  { value: 'price_below', label: '跌破指定价格' },
  { value: 'ma_cross_above', label: '突破均线' },
  { value: 'ma_cross_below', label: '跌破均线' },
];

const MA_OPTIONS = [
  { value: 'ma5', label: 'MA5（5日均线）' },
  { value: 'ma10', label: 'MA10（10日均线）' },
  { value: 'ma20', label: 'MA20（20日均线）' },
];

function conditionText(type: MonitorType, targetPrice: number | null, maPeriod: MaPeriod | null): string {
  switch (type) {
    case 'price_above': return `突破 ¥${targetPrice?.toFixed(2) ?? '-'}`;
    case 'price_below': return `跌破 ¥${targetPrice?.toFixed(2) ?? '-'}`;
    case 'ma_cross_above': return `突破 ${(maPeriod ?? '').toUpperCase()}`;
    case 'ma_cross_below': return `跌破 ${(maPeriod ?? '').toUpperCase()}`;
  }
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

interface Props {
  market: 'A' | 'HK';
  code: string;
  stockName: string;
}

export default function StockMonitorButton({ market, code, stockName }: Props) {
  const [open, setOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [monitorType, setMonitorType] = useState<MonitorType>('price_above');
  const [form] = Form.useForm();

  const { rules, createRule, deleteRule, toggleRule } = useMonitorStore();

  const stockRules = rules
    .filter((r) => r.stockMarket === market && r.stockCode === code)
    .sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      return b.createdAt - a.createdAt;
    });
  const activeCount = stockRules.filter((r) => r.active).length;

  const handleAddRule = async () => {
    try {
      const values = (await form.validateFields()) as {
        type: MonitorType;
        targetPrice?: number;
        maPeriod?: MaPeriod;
      };
      await createRule({
        stockCode: code,
        stockMarket: market,
        stockName,
        type: values.type,
        targetPrice: values.targetPrice,
        maPeriod: values.maPeriod,
      });
      form.resetFields();
      setMonitorType('price_above');
      setAddOpen(false);
    } catch {
      /* 表单验证失败，保持弹窗打开 */
    }
  };

  const handleCancelAdd = () => {
    setAddOpen(false);
    form.resetFields();
    setMonitorType('price_above');
  };

  return (
    <>
      <Badge count={activeCount} size="small" offset={[-4, 4]}>
        <Button size="small" icon={<BellOutlined />} onClick={() => setOpen(true)}>
          监控规则
        </Button>
      </Badge>

      <Modal
        title={`监控规则 · ${stockName}`}
        open={open}
        onCancel={() => setOpen(false)}
        footer={null}
        width={440}
        styles={{ body: { padding: '8px 16px' } }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <Typography.Text type="secondary" style={{ fontSize: 12, flex: 1 }}>
            每条规则每 30 分钟最多触发一次
          </Typography.Text>
          <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>
            添加规则
          </Button>
        </div>

        {stockRules.length === 0 ? (
          <Empty description="暂无监控规则" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ margin: '24px 0' }} />
        ) : (
          <div style={{ maxHeight: 320, overflowY: 'auto' }}>
            {stockRules.map((rule) => (
              <div
                key={rule.id}
                style={{ padding: '8px 0', borderBottom: '1px solid #f0f0f0' }}
              >
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <Typography.Text style={{ fontSize: 13, flex: 1 }}>
                    {conditionText(rule.type, rule.targetPrice, rule.maPeriod)}
                  </Typography.Text>
                  <Tooltip title={rule.active ? '暂停监控' : '重新激活'}>
                    <Tag
                      color={rule.active ? 'success' : 'default'}
                      style={{ cursor: 'pointer', marginRight: 4 }}
                      onClick={() => void toggleRule(rule.id, !rule.active)}
                    >
                      {rule.active ? '监控中' : '已暂停'}
                    </Tag>
                  </Tooltip>
                  <Tooltip title="删除规则">
                    <Button
                      type="text"
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => void deleteRule(rule.id)}
                    />
                  </Tooltip>
                </div>
                {rule.lastTriggeredAt && (
                  <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                    上次触发 {fmtTime(rule.lastTriggeredAt)}
                  </Typography.Text>
                )}
              </div>
            ))}
          </div>
        )}
      </Modal>

      <Modal
        title={`添加监控规则 · ${stockName}`}
        open={addOpen}
        onOk={() => void handleAddRule()}
        onCancel={handleCancelAdd}
        okText="添加"
        cancelText="取消"
        destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
          style={{ marginTop: 16 }}
          initialValues={{ type: 'price_above' }}
        >
          <Form.Item
            name="type"
            label="监控条件"
            rules={[{ required: true, message: '请选择监控条件' }]}
          >
            <Select
              options={TYPE_OPTIONS}
              onChange={(v: MonitorType) => {
                setMonitorType(v);
                form.resetFields(['targetPrice', 'maPeriod']);
              }}
            />
          </Form.Item>
          {(monitorType === 'price_above' || monitorType === 'price_below') && (
            <Form.Item
              name="targetPrice"
              label="目标价格"
              rules={[{ required: true, message: '请输入目标价格' }]}
            >
              <InputNumber
                min={0.01}
                precision={2}
                prefix="¥"
                style={{ width: '100%' }}
                placeholder="请输入价格"
              />
            </Form.Item>
          )}
          {(monitorType === 'ma_cross_above' || monitorType === 'ma_cross_below') && (
            <Form.Item
              name="maPeriod"
              label="均线"
              rules={[{ required: true, message: '请选择均线' }]}
            >
              <Select options={MA_OPTIONS} placeholder="请选择均线" />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </>
  );
}

StockMonitorButton.displayName = 'StockMonitorButton';
