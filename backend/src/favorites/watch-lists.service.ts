import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { WatchList } from './watch-list.entity';
import { Favorite } from './favorite.entity';

export type BoardType = 'stock' | 'fund';

@Injectable()
export class WatchListsService {
  constructor(
    @InjectRepository(WatchList)
    private readonly repo: Repository<WatchList>,
    @InjectRepository(Favorite)
    private readonly favoriteRepo: Repository<Favorite>,
  ) {}

  /**
   * 历史数据迁移：把无归属（user_id 为空）的标的列表归到指定用户，
   * 确保该用户两个板块各有一个默认「收藏夹」，并回填无列表的孤儿收藏。
   * 由 AuthService 在种入内置账号后调用，幂等。
   */
  async migrateLegacyData(userId: number): Promise<void> {
    const orphanLists = await this.repo.find({ where: { userId: IsNull() } });
    if (orphanLists.length > 0) {
      orphanLists.forEach((l) => {
        l.userId = userId;
      });
      await this.repo.save(orphanLists);
    }
    for (const boardType of ['stock', 'fund'] as const) {
      const defaultList = await this.ensureDefaultList(userId, boardType);
      await this.backfillOrphanFavorites(userId, boardType, defaultList.id);
    }
  }

  /** 取得（必要时创建）某用户某板块的默认列表。 */
  async ensureDefaultList(userId: number, boardType: BoardType): Promise<WatchList> {
    const existing = await this.repo.findOne({
      where: { userId, boardType, isDefault: true },
    });
    if (existing) return existing;
    return this.repo.save(this.repo.create({ userId, name: '收藏夹', boardType, isDefault: true }));
  }

  private async backfillOrphanFavorites(
    userId: number,
    boardType: BoardType,
    defaultListId: number,
  ): Promise<void> {
    const orphans = await this.favoriteRepo.find({ where: { watchListId: IsNull() } });
    const matching = orphans.filter((f) =>
      boardType === 'fund' ? f.market === 'FUND' : f.market !== 'FUND',
    );
    if (matching.length === 0) return;
    matching.forEach((f) => {
      f.watchListId = defaultListId;
    });
    await this.favoriteRepo.save(matching);
  }

  async findAll(userId: number, boardType: BoardType): Promise<WatchList[]> {
    await this.ensureDefaultList(userId, boardType);
    return this.repo.find({
      where: { userId, boardType },
      order: { isDefault: 'DESC', createdAt: 'ASC' },
    });
  }

  async create(data: { userId: number; name: string; boardType: BoardType }): Promise<WatchList> {
    const list = this.repo.create({
      userId: data.userId,
      name: data.name,
      boardType: data.boardType,
      isDefault: false,
    });
    return this.repo.save(list);
  }

  async remove(id: number, userId: number): Promise<void> {
    const list = await this.repo.findOneBy({ id });
    if (!list || list.userId !== userId) throw new NotFoundException(`WatchList ${id} not found`);
    if (list.isDefault) throw new BadRequestException('默认列表不可删除');
    await this.favoriteRepo.delete({ watchListId: id });
    await this.repo.delete(id);
  }
}
