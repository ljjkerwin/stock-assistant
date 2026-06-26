import { SetMetadata } from '@nestjs/common';

/** 标记路由为公开（无需登录即可访问），由全局 AuthGuard 识别。 */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
