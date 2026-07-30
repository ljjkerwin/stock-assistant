import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'crypto';
import { IsNull, Repository } from 'typeorm';
import { PluginAccessToken } from './plugin-access-token.entity';

const TOKEN_PREFIX = 'xhs_';
const MAX_REQUESTS_PER_MINUTE = 60;

@Injectable()
export class PluginTokenService {
  private readonly rateBuckets = new Map<number, { windowStart: number; count: number }>();

  constructor(
    @InjectRepository(PluginAccessToken) private readonly tokenRepo: Repository<PluginAccessToken>,
  ) {}

  async list(userId: number) {
    return this.tokenRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      select: ['id', 'name', 'createdAt', 'expiresAt', 'lastUsedAt', 'revokedAt'],
    });
  }

  async create(userId: number, name: string, expiresInDays = 180) {
    if (!name.trim()) throw new BadRequestException('令牌名称不能为空');
    if (!Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > 365)
      throw new BadRequestException('有效期必须是 1–365 天');
    const token = `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
    const expiresAt = new Date(Date.now() + expiresInDays * 86400000);
    const saved = await this.tokenRepo.save(
      this.tokenRepo.create({
        userId,
        name: name.trim(),
        tokenHash: this.hash(token),
        expiresAt,
        lastUsedAt: null,
        revokedAt: null,
      }),
    );
    return { id: saved.id, name: saved.name, token, expiresAt: saved.expiresAt };
  }

  async revoke(userId: number, id: number) {
    const result = await this.tokenRepo.update(
      { id, userId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
    if (!result.affected) throw new BadRequestException('令牌不存在或已撤销');
    this.rateBuckets.delete(id);
    return { success: true };
  }

  async verifyForDarkTradeQuery(token: string): Promise<void> {
    const record = await this.tokenRepo.findOne({ where: { tokenHash: this.hash(token) } });
    if (!record || record.revokedAt || (record.expiresAt && record.expiresAt < new Date()))
      throw new UnauthorizedException('插件令牌无效、已撤销或已过期');
    const now = Date.now();
    const bucket = this.rateBuckets.get(record.id);
    const current =
      !bucket || now - bucket.windowStart >= 60000 ? { windowStart: now, count: 0 } : bucket;
    current.count += 1;
    this.rateBuckets.set(record.id, current);
    if (current.count > MAX_REQUESTS_PER_MINUTE)
      throw new HttpException(
        '插件令牌每分钟最多检索 60 次，请稍后重试',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    await this.tokenRepo.update(record.id, { lastUsedAt: new Date() });
  }

  private hash(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }
}
