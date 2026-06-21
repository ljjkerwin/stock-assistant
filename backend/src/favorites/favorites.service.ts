import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Favorite } from './favorite.entity';
import { WatchList } from './watch-list.entity';

@Injectable()
export class FavoritesService {
  constructor(
    @InjectRepository(Favorite)
    private readonly repo: Repository<Favorite>,
    @InjectRepository(WatchList)
    private readonly watchListRepo: Repository<WatchList>,
  ) {}

  findAll(watchListId: number): Promise<Favorite[]> {
    return this.repo.find({
      where: { watchListId },
      order: { pinned: 'DESC', sortOrder: 'ASC', createdAt: 'ASC' },
    });
  }

  async add(data: {
    code: string;
    market: string;
    name: string;
    watchListId: number;
  }): Promise<Favorite> {
    const list = await this.watchListRepo.findOneBy({ id: data.watchListId });
    if (!list) throw new NotFoundException(`WatchList ${data.watchListId} not found`);
    const expectedBoardType = data.market === 'FUND' ? 'fund' : 'stock';
    if (list.boardType !== expectedBoardType) {
      throw new BadRequestException(`标的市场 ${data.market} 与列表板块 ${list.boardType} 不匹配`);
    }
    const count = await this.repo.count({ where: { watchListId: data.watchListId } });
    const fav = this.repo.create({ ...data, sortOrder: count });
    return this.repo.save(fav);
  }

  async remove(id: number): Promise<void> {
    const result = await this.repo.delete(id);
    if (result.affected === 0) throw new NotFoundException(`Favorite ${id} not found`);
  }

  async update(id: number, data: { sortOrder?: number; pinned?: boolean }): Promise<Favorite> {
    const fav = await this.repo.findOneBy({ id });
    if (!fav) throw new NotFoundException(`Favorite ${id} not found`);
    if (data.sortOrder !== undefined) fav.sortOrder = data.sortOrder;
    if (data.pinned !== undefined) fav.pinned = data.pinned;
    return this.repo.save(fav);
  }
}
