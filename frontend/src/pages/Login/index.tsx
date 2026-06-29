import { useState } from 'react';
import { Button, Card, Checkbox, Form, Input, Typography, message } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import { useAuthStore } from '../../store/authStore';
import {
  getRememberedCredentials,
  setRememberedCredentials,
  clearRememberedCredentials,
} from '../../api/token';

const { Title } = Typography;

interface LoginForm {
  username: string;
  password: string;
  remember: boolean;
}

export default function Login() {
  const login = useAuthStore((s) => s.login);
  const [loading, setLoading] = useState(false);
  const remembered = getRememberedCredentials();

  const onFinish = async (values: LoginForm) => {
    setLoading(true);
    try {
      const username = values.username.trim();
      await login(username, values.password);
      if (values.remember) {
        setRememberedCredentials({ username, password: values.password });
      } else {
        clearRememberedCredentials();
      }
    } catch (error) {
      const msg =
        (error as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        '登录失败，请重试';
      message.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f0f2f5',
      }}
    >
      <Card style={{ width: 360 }}>
        <Title level={3} style={{ textAlign: 'center', marginBottom: 24 }}>
          股票助手登录
        </Title>
        <Form
          onFinish={onFinish}
          size="large"
          initialValues={{
            username: remembered?.username ?? '',
            password: remembered?.password ?? '',
            remember: !!remembered,
          }}
        >
          <Form.Item name="username" rules={[{ required: true, message: '请输入用户名' }]}>
            <Input prefix={<UserOutlined />} placeholder="用户名" autoFocus />
          </Form.Item>
          <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="密码" />
          </Form.Item>
          <Form.Item name="remember" valuePropName="checked">
            <Checkbox>记住密码</Checkbox>
          </Form.Item>
          <Form.Item style={{ marginBottom: 0 }}>
            <Button type="primary" htmlType="submit" block loading={loading}>
              登录
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}
