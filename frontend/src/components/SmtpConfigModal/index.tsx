import { useEffect, useState } from 'react';
import { Modal, Form, Input, InputNumber, Switch, Button, message, Alert, Space } from 'antd';
import { MailOutlined, SendOutlined, SaveOutlined } from '@ant-design/icons';
import { authApi, type SmtpConfig } from '../../api/stock';

interface SmtpConfigModalProps {
  open: boolean;
  onCancel: () => void;
}

export default function SmtpConfigModal({ open, onCancel }: SmtpConfigModalProps) {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  // Fetch current config when opening the modal
  useEffect(() => {
    if (open) {
      setLoading(true);
      authApi
        .getSmtp()
        .then((data) => {
          form.setFieldsValue(data);
        })
        .catch((err) => {
          console.error(err);
          message.error('获取 SMTP 配置失败');
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [open, form]);

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      await authApi.saveSmtp(values as SmtpConfig);
      message.success('保存成功');
      onCancel();
    } catch (err) {
      if (err instanceof Error) {
        message.error(`保存失败: ${err.message}`);
      } else {
        console.warn('Validation failed:', err);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    try {
      const values = await form.validateFields();
      setTesting(true);
      const res = await authApi.testSmtp(values as SmtpConfig);
      if (res.success) {
        message.success('测试邮件发送成功，请查收！');
      } else {
        message.error('测试邮件发送失败');
      }
    } catch (err) {
      if (err instanceof Error) {
        const errMsg = (err as { response?: { data?: { message?: string } } }).response?.data?.message || err.message;
        message.error(`测试失败: ${errMsg}`);
      } else {
        console.warn('Validation failed:', err);
      }
    } finally {
      setTesting(false);
    }
  };

  return (
    <Modal
      title={
        <Space>
          <MailOutlined style={{ color: '#1677ff' }} />
          <span>通知邮箱 SMTP 设置</span>
        </Space>
      }
      open={open}
      onCancel={onCancel}
      confirmLoading={saving}
      width={520}
      footer={[
        <Button key="cancel" onClick={onCancel} disabled={saving || testing}>
          取消
        </Button>,
        <Button
          key="test"
          icon={<SendOutlined />}
          loading={testing}
          disabled={loading || saving}
          onClick={handleTest}
        >
          发送测试邮件
        </Button>,
        <Button
          key="save"
          type="primary"
          icon={<SaveOutlined />}
          loading={saving}
          disabled={loading || testing}
          onClick={handleSave}
        >
          保存
        </Button>,
      ]}
    >
      <Alert
        message="配置提示"
        description="系统将在价格或均线报警触发时，通过此 SMTP 邮箱自动发送邮件给收件人。若是 163 或 QQ 等常用邮箱，密码通常应填写邮箱设置中生成的「授权码/应用密码」，而非您的登录密码。"
        type="info"
        showIcon
        style={{ marginBottom: 16, marginTop: 8 }}
      />

      <Form form={form} layout="vertical" disabled={loading || saving || testing}>
        <Form.Item
          label="SMTP 服务器地址 (Host)"
          name="smtpHost"
          rules={[{ required: true, message: '请输入 SMTP 服务器地址' }]}
        >
          <Input placeholder="例如: smtp.163.com 或 smtp.qq.com" />
        </Form.Item>

        <Form.Item
          label="SMTP 端口 (Port)"
          name="smtpPort"
          rules={[{ required: true, message: '请输入端口号' }]}
        >
          <InputNumber style={{ width: '100%' }} placeholder="SSL 端口通常为 465，非 SSL 通常为 25 或 587" />
        </Form.Item>

        <Form.Item
          name="smtpSecure"
          valuePropName="checked"
          label="安全连接 (Secure / SSL/TLS)"
        >
          <Switch checkedChildren="开启" unCheckedChildren="关闭" />
        </Form.Item>

        <Form.Item
          label="SMTP 登录账号 (User)"
          name="smtpUser"
          rules={[{ required: true, message: '请输入 SMTP 登录账号' }]}
        >
          <Input placeholder="例如: user@163.com 或 username" />
        </Form.Item>

        <Form.Item
          label="SMTP 授权密码 (Password / Auth Code)"
          name="smtpPass"
          rules={[{ required: true, message: '请输入密码或邮箱授权码' }]}
        >
          <Input.Password placeholder="邮箱授权码或应用密码" />
        </Form.Item>

        <Form.Item
          label="警报接收邮箱 (To)"
          name="smtpTo"
          rules={[{ required: true, type: 'email', message: '请输入有效的接收邮箱地址' }]}
        >
          <Input placeholder="接收报警邮件的邮箱地址" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
