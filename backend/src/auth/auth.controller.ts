import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  BadRequestException,
} from '@nestjs/common';
import { AuthService, SmtpConfigDto } from './auth.service';
import { PluginTokenService } from './plugin-token.service';
import { Public } from './public.decorator';
import { CurrentUser } from './current-user.decorator';
import type { AuthUser } from './current-user.decorator';
import * as nodemailer from 'nodemailer';

@Controller('api/auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly pluginTokenService: PluginTokenService,
  ) {}

  @Public()
  @Post('login')
  login(@Body() body: { username: string; password: string }) {
    return this.authService.login(body.username, body.password);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return user;
  }

  @Get('plugin-tokens')
  listPluginTokens(@CurrentUser() user: AuthUser) {
    return this.pluginTokenService.list(user.id);
  }

  @Post('plugin-tokens')
  createPluginToken(
    @CurrentUser() user: AuthUser,
    @Body() body: { name?: string; expiresInDays?: number },
  ) {
    return this.pluginTokenService.create(user.id, body.name ?? '', body.expiresInDays ?? 180);
  }

  @Delete('plugin-tokens/:id')
  revokePluginToken(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.pluginTokenService.revoke(user.id, id);
  }

  @Get('smtp')
  getSmtp(@CurrentUser() user: AuthUser) {
    return this.authService.getSmtp(user.id);
  }

  @Post('smtp')
  saveSmtp(@CurrentUser() user: AuthUser, @Body() body: SmtpConfigDto) {
    return this.authService.saveSmtp(user.id, body);
  }

  @Post('smtp/test')
  async testSmtp(@CurrentUser() user: AuthUser, @Body() body: SmtpConfigDto) {
    const host = body.smtpHost || '';
    const smtpUser = body.smtpUser || '';
    let fromEmail = smtpUser;
    if (smtpUser && host && !smtpUser.includes('@')) {
      const hostParts = host.split('.');
      if (hostParts.length >= 2) {
        const domain = hostParts.slice(-2).join('.');
        fromEmail = `${smtpUser}@${domain}`;
      }
    }

    const transporter = nodemailer.createTransport({
      host: body.smtpHost,
      port: body.smtpPort,
      secure: body.smtpSecure,
      auth: {
        user: body.smtpUser,
        pass: body.smtpPass,
      },
    });

    try {
      await transporter.sendMail({
        from: `"股票助手测试" <${fromEmail}>`,
        to: body.smtpTo,
        subject: '[股票助手] SMTP 邮件发送测试',
        text: '这是一封测试邮件，恭喜您，您的 SMTP 邮箱配置成功！',
      });
      return { success: true };
    } catch (err) {
      throw new BadRequestException(`SMTP test failed: ${(err as Error).message}`);
    }
  }
}
