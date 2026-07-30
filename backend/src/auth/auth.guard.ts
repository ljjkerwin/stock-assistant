import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService } from './auth.service';
import { PluginTokenService } from './plugin-token.service';
import { IS_PUBLIC_KEY } from './public.decorator';
import type { AuthUser } from './current-user.decorator';

interface AuthRequest {
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, unknown>;
  user?: AuthUser;
}

/** 全局守卫：除 @Public() 路由外，一律要求合法令牌；令牌可走 Header 或 query（供 SSE）。 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly authService: AuthService,
    private readonly pluginTokenService: PluginTokenService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthRequest>();
    const token = this.extractToken(request);
    if (!token) throw new UnauthorizedException('未登录');
    const route = context.switchToHttp().getRequest<{ method?: string; path?: string }>();
    if (
      token.startsWith('xhs_') &&
      route.method === 'POST' &&
      route.path === '/api/darktrade/daily-result-from-text'
    ) {
      await this.pluginTokenService.verifyForDarkTradeQuery(token);
      return true;
    }
    request.user = this.authService.verifyToken(token);
    return true;
  }

  private extractToken(request: AuthRequest): string | null {
    const header = request.headers['authorization'];
    const value = Array.isArray(header) ? header[0] : header;
    if (value?.startsWith('Bearer ')) return value.slice(7);
    const queryToken = request.query?.token;
    return typeof queryToken === 'string' ? queryToken : null;
  }
}
