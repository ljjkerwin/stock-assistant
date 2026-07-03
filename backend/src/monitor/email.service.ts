import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not, IsNull } from 'typeorm';
import * as nodemailer from 'nodemailer';
import { User } from '../auth/user.entity';

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

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {
    const user = process.env.EMAIL_USER;
    const pass = process.env.EMAIL_PASS;
    this.to = process.env.EMAIL_TO ?? '';

    if (!user || !pass || !this.to) {
      this.logger.warn(
        'EMAIL_USER, EMAIL_PASS 或 EMAIL_TO 未配置，环境配置的邮件通知已禁用，将仅使用数据库动态配置',
      );
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

    let sentToDbUsers = false;
    try {
      const users = await this.userRepo.find({
        where: {
          smtpHost: Not(IsNull()),
          smtpUser: Not(IsNull()),
          smtpPass: Not(IsNull()),
          smtpTo: Not(IsNull()),
        },
      });

      for (const u of users) {
        if (!u.smtpHost || !u.smtpUser || !u.smtpPass || !u.smtpTo) continue;
        const config = {
          host: u.smtpHost,
          port: u.smtpPort ?? 465,
          secure: u.smtpSecure ?? true,
          user: u.smtpUser,
          pass: u.smtpPass,
        };

        let fromEmail = config.user;
        if (!config.user.includes('@')) {
          const hostParts = config.host.split('.');
          if (hostParts.length >= 2) {
            const domain = hostParts.slice(-2).join('.');
            fromEmail = `${config.user}@${domain}`;
          }
        }

        const transporter = nodemailer.createTransport({
          host: config.host,
          port: config.port,
          secure: config.secure,
          auth: { user: config.user, pass: config.pass },
        });

        try {
          await transporter.sendMail({
            from: `"股票助手" <${fromEmail}>`,
            to: u.smtpTo,
            subject,
            text,
          });
          this.logger.log(
            `[邮件] 已发送通知至数据库配置的用户邮箱 ${u.smtpTo}，由 ${fromEmail} 发出`,
          );
          sentToDbUsers = true;
        } catch (err) {
          this.logger.error(`[邮件] 发送失败(用户 ${u.username}): ${(err as Error).message}`);
        }
      }
    } catch (dbErr) {
      this.logger.error(`[邮件] 查询用户自定义SMTP失败: ${(dbErr as Error).message}`);
    }

    if (!sentToDbUsers && this.transporter) {
      try {
        await this.transporter.sendMail({
          from: `"股票助手" <${process.env.EMAIL_USER}>`,
          to: this.to,
          subject,
          text,
        });
        this.logger.log(`[邮件] 已通过环境变量兜底发送通知至 ${this.to}`);
      } catch (err) {
        this.logger.error(`[邮件] 兜底发送失败：${(err as Error).message}`);
      }
    }
  }
}
