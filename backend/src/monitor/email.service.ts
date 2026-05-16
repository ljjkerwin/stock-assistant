import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

const RULE_TYPE_LABELS: Record<string, string> = {
  price_above: '价格突破上方目标',
  price_below: '价格跌破下方目标',
  ma_cross_above: '价格上穿均线',
  ma_cross_below: '价格下穿均线',
};

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly transporter: nodemailer.Transporter | null;
  private readonly to: string;

  constructor() {
    const user = process.env.EMAIL_USER;
    const pass = process.env.EMAIL_PASS;
    this.to = process.env.EMAIL_TO ?? 'ljjnotice@163.com';

    if (!user || !pass) {
      this.logger.warn('EMAIL_USER 或 EMAIL_PASS 未配置，邮件通知已禁用');
      this.transporter = null;
      return;
    }

    this.transporter = nodemailer.createTransport({
      host: 'smtp.163.com',
      port: 465,
      secure: true,
      auth: { user, pass },
    });
  }

  async sendMonitorAlert(payload: {
    stockName: string;
    stockCode: string;
    stockMarket: string;
    type: string;
    currentPrice: number;
    targetValue: number;
    maPeriod?: string | null;
    triggeredAt: number;
  }): Promise<void> {
    if (!this.transporter) return;

    const {
      stockName,
      stockCode,
      stockMarket,
      type,
      currentPrice,
      targetValue,
      maPeriod,
      triggeredAt,
    } = payload;
    const label = RULE_TYPE_LABELS[type] ?? type;
    const maTag = maPeriod ? ` ${maPeriod.toUpperCase()}` : '';
    const subject = `[股票助手] ${stockName}(${stockCode}·${stockMarket}) ${label}${maTag}`;
    const time = new Date(triggeredAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

    const text = [
      `股票：${stockName}（${stockCode}·${stockMarket}）`,
      `触发规则：${label}${maTag}`,
      `当前价格：${currentPrice.toFixed(2)}`,
      `目标价/均线值：${targetValue.toFixed(2)}`,
      `触发时间：${time}`,
    ].join('\n');

    try {
      await this.transporter.sendMail({
        from: `"股票助手" <${process.env.EMAIL_USER}>`,
        to: this.to,
        subject,
        text,
      });
      this.logger.log(`[邮件] 已发送通知至 ${this.to}：${subject}`);
    } catch (err) {
      this.logger.error(`[邮件] 发送失败：${(err as Error).message}`);
    }
  }
}
