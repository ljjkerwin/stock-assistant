import { Injectable, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { User } from './user.entity';
import { WatchListsService } from '../favorites/watch-lists.service';
import type { AuthUser } from './current-user.decorator';

/** 令牌默认有效期：7 天（秒）。 */
const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

/** 初始内置账号，首次启动自动创建。 */
const SEED_USERNAME = 'ljj';
const SEED_PASSWORD = 'asdfasdf';

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

@Injectable()
export class AuthService implements OnModuleInit {
  /** 令牌签名密钥，可通过 AUTH_SECRET 覆盖；缺省给开发期兜底值。 */
  private readonly secret = process.env.AUTH_SECRET || 'stock-assistant-dev-secret';

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly watchListsService: WatchListsService,
  ) {}

  /** 启动时种入内置账号，并把历史标的列表/收藏归到该账号下。 */
  async onModuleInit(): Promise<void> {
    let user = await this.userRepo.findOne({ where: { username: SEED_USERNAME } });
    if (!user) {
      user = await this.userRepo.save(
        this.userRepo.create({
          username: SEED_USERNAME,
          passwordHash: this.hashPassword(SEED_PASSWORD),
        }),
      );
    }
    await this.watchListsService.migrateLegacyData(user.id);
  }

  // ---- 密码哈希（scrypt，格式 salt:hash 十六进制）----

  hashPassword(password: string): string {
    const salt = randomBytes(16);
    const derived = scryptSync(password, salt, 64);
    return `${salt.toString('hex')}:${derived.toString('hex')}`;
  }

  verifyPassword(password: string, stored: string): boolean {
    const [saltHex, hashHex] = stored.split(':');
    if (!saltHex || !hashHex) return false;
    const derived = scryptSync(password, Buffer.from(saltHex, 'hex'), 64);
    const expected = Buffer.from(hashHex, 'hex');
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  }

  // ---- 令牌（精简版 JWT：HMAC-SHA256 签名）----

  signToken(user: AuthUser): string {
    const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = base64url(
      JSON.stringify({
        sub: user.id,
        username: user.username,
        exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
      }),
    );
    const sig = this.sign(`${header}.${payload}`);
    return `${header}.${payload}.${sig}`;
  }

  verifyToken(token: string): AuthUser {
    const parts = token.split('.');
    if (parts.length !== 3) throw new UnauthorizedException('令牌格式错误');
    const [header, payload, sig] = parts;
    const expected = this.sign(`${header}.${payload}`);
    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
      throw new UnauthorizedException('令牌签名无效');
    }
    let claims: { sub: number; username: string; exp: number };
    try {
      claims = JSON.parse(Buffer.from(payload, 'base64').toString('utf8')) as typeof claims;
    } catch {
      throw new UnauthorizedException('令牌解析失败');
    }
    if (!claims.exp || claims.exp * 1000 < Date.now()) {
      throw new UnauthorizedException('登录已过期');
    }
    return { id: claims.sub, username: claims.username };
  }

  private sign(data: string): string {
    return base64url(createHmac('sha256', this.secret).update(data).digest());
  }

  // ---- 登录 / 当前用户 ----

  async login(username: string, password: string): Promise<{ token: string; user: AuthUser }> {
    const user = await this.userRepo.findOne({ where: { username } });
    if (!user || !this.verifyPassword(password, user.passwordHash)) {
      throw new UnauthorizedException('用户名或密码错误');
    }
    const authUser: AuthUser = { id: user.id, username: user.username };
    return { token: this.signToken(authUser), user: authUser };
  }
}
