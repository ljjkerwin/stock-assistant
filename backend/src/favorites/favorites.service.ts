import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Favorite } from './favorite.entity';
import { WatchList } from './watch-list.entity';
import { StocksService } from '../stocks/stocks.service';
import { FundService } from '../fund/fund.service';

@Injectable()
export class FavoritesService {
  constructor(
    @InjectRepository(Favorite)
    private readonly repo: Repository<Favorite>,
    @InjectRepository(WatchList)
    private readonly watchListRepo: Repository<WatchList>,
    private readonly stocksService: StocksService,
    private readonly fundService: FundService,
  ) {}

  /** 校验列表归属当前用户，否则视为不存在。 */
  private async ownedList(watchListId: number, userId: number): Promise<WatchList> {
    const list = await this.watchListRepo.findOneBy({ id: watchListId });
    if (!list || list.userId !== userId) {
      throw new NotFoundException(`WatchList ${watchListId} not found`);
    }
    return list;
  }

  async findAll(watchListId: number, userId: number): Promise<Favorite[]> {
    await this.ownedList(watchListId, userId);
    return this.repo.find({
      where: { watchListId },
      order: { pinned: 'DESC', sortOrder: 'ASC', createdAt: 'ASC' },
    });
  }

  async add(
    data: { code: string; market: string; name: string; watchListId: number },
    userId: number,
  ): Promise<Favorite> {
    const list = await this.ownedList(data.watchListId, userId);
    const expectedBoardType = data.market === 'FUND' ? 'fund' : 'stock';
    if (list.boardType !== expectedBoardType) {
      throw new BadRequestException(`标的市场 ${data.market} 与列表板块 ${list.boardType} 不匹配`);
    }

    // Backend self-correction: if name is empty or is equal to the code, fetch the name from stock or fund service
    if (!data.name || data.name.trim() === data.code.trim()) {
      try {
        if (data.market === 'FUND') {
          const info = await this.fundService.getFundInfo(data.code);
          if (info?.name) {
            data.name = info.name;
          }
        } else {
          const info = await this.stocksService.getInfo(data.market as 'A' | 'HK', data.code);
          if (info?.name) {
            data.name = info.name;
          }
        }
      } catch {
        // Fallback to whatever name was provided (even if code)
      }
    }

    const existing = await this.repo.findOneBy({
      watchListId: data.watchListId,
      code: data.code,
      market: data.market,
    });
    if (existing) return existing;
    const lastFav = await this.repo.findOne({
      where: { watchListId: data.watchListId },
      order: { sortOrder: 'DESC' },
    });
    const nextSortOrder = lastFav ? lastFav.sortOrder + 1 : 0;
    const fav = this.repo.create({ ...data, sortOrder: nextSortOrder });
    return this.repo.save(fav);
  }

  async remove(id: number, userId: number): Promise<void> {
    const fav = await this.repo.findOneBy({ id });
    if (!fav) throw new NotFoundException(`Favorite ${id} not found`);
    await this.ownedList(fav.watchListId!, userId);
    await this.repo.delete(id);
  }

  async update(
    id: number,
    userId: number,
    data: { sortOrder?: number; pinned?: boolean },
  ): Promise<Favorite> {
    const fav = await this.repo.findOneBy({ id });
    if (!fav) throw new NotFoundException(`Favorite ${id} not found`);
    await this.ownedList(fav.watchListId!, userId);
    if (data.sortOrder !== undefined) fav.sortOrder = data.sortOrder;
    if (data.pinned !== undefined) fav.pinned = data.pinned;
    return this.repo.save(fav);
  }
}
