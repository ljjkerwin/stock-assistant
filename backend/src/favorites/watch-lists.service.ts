import { Injectable, NotFoundException, BadRequestException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { WatchList } from './watch-list.entity';
import { Favorite } from './favorite.entity';

export type BoardType = 'stock' | 'fund';

@Injectable()
export class WatchListsService implements OnModuleInit {
  constructor(
    @InjectRepository(WatchList)
    private readonly repo: Repository<WatchList>,
    @InjectRepository(Favorite)
    private readonly favoriteRepo: Repository<Favorite>,
  ) {}

  async onModuleInit(): Promise<void> {
    for (const boardType of ['stock', 'fund'] as const) {
      const defaultList = await this.ensureDefaultList(boardType);
      await this.backfillOrphans(boardType, defaultList.id);
    }
  }

  private async ensureDefaultList(boardType: BoardType): Promise<WatchList> {
    const existing = await this.repo.findOne({ where: { boardType, isDefault: true } });
    if (existing) return existing;
    return this.repo.save(this.repo.create({ name: '收藏夹', boardType, isDefault: true }));
  }

  private async backfillOrphans(boardType: BoardType, defaultListId: number): Promise<void> {
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

  findAll(boardType: BoardType): Promise<WatchList[]> {
    return this.repo.find({
      where: { boardType },
      order: { isDefault: 'DESC', createdAt: 'ASC' },
    });
  }

  async create(data: { name: string; boardType: BoardType }): Promise<WatchList> {
    const list = this.repo.create({ name: data.name, boardType: data.boardType, isDefault: false });
    return this.repo.save(list);
  }

  async remove(id: number): Promise<void> {
    const list = await this.repo.findOneBy({ id });
    if (!list) throw new NotFoundException(`WatchList ${id} not found`);
    if (list.isDefault) throw new BadRequestException('默认列表不可删除');
    await this.favoriteRepo.delete({ watchListId: id });
    await this.repo.delete(id);
  }
}
