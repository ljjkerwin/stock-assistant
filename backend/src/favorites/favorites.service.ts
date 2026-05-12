import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Favorite } from './favorite.entity';

@Injectable()
export class FavoritesService {
  constructor(
    @InjectRepository(Favorite)
    private readonly repo: Repository<Favorite>,
  ) {}

  findAll(): Promise<Favorite[]> {
    return this.repo.find({
      order: { pinned: 'DESC', sortOrder: 'ASC', createdAt: 'ASC' },
    });
  }

  async add(data: { code: string; market: string; name: string }): Promise<Favorite> {
    const count = await this.repo.count();
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
