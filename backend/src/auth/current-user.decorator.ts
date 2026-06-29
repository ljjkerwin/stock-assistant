import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthUser {
  id: number;
  username: string;
}

/** 从请求中取出 AuthGuard 注入的当前登录用户。 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const request = ctx.switchToHttp().getRequest<{ user: AuthUser }>();
    return request.user;
  },
);
