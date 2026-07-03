import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { FavoritesService } from './favorites.service';
import { Favorite } from './favorite.entity';
import { WatchList } from './watch-list.entity';
import { StocksService } from '../stocks/stocks.service';
import { FundService } from '../fund/fund.service';

describe('FavoritesService', () => {
  let repo: {
    find: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    count: jest.Mock;
    delete: jest.Mock;
    findOneBy: jest.Mock;
    findOne: jest.Mock;
  };
  let watchListRepo: { findOneBy: jest.Mock };
  let stocksService: { getInfo: jest.Mock };
  let fundService: { getFundInfo: jest.Mock };

  let service: FavoritesService;

  beforeEach(() => {
    repo = {
      find: jest.fn(),
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      create: jest.fn((data) => data),
      // eslint-disable-next-line @typescript-eslint/require-await
      save: jest.fn(async (data: Record<string, unknown>) => ({ id: 1, ...data })),
      count: jest.fn().mockResolvedValue(0),
      delete: jest.fn(),
      findOneBy: jest.fn(),
      findOne: jest.fn(),
    };
    watchListRepo = { findOneBy: jest.fn() };
    stocksService = { getInfo: jest.fn() };
    fundService = { getFundInfo: jest.fn() };

    service = new FavoritesService(
      repo as unknown as Repository<Favorite>,
      watchListRepo as unknown as Repository<WatchList>,
      stocksService as unknown as StocksService,
      fundService as unknown as FundService,
    );
  });

  describe('findAll', () => {
    it('filters favorites by watchListId when the list belongs to the user', async () => {
      watchListRepo.findOneBy.mockResolvedValue({ id: 7, userId: 42, boardType: 'stock' });
      repo.find.mockResolvedValue([]);

      await service.findAll(7, 42);

      expect(repo.find).toHaveBeenCalledWith({
        where: { watchListId: 7 },
        order: { pinned: 'DESC', sortOrder: 'ASC', createdAt: 'ASC' },
      });
    });

    it('throws NotFoundException when the list belongs to another user', async () => {
      watchListRepo.findOneBy.mockResolvedValue({ id: 7, userId: 99, boardType: 'stock' });

      await expect(service.findAll(7, 42)).rejects.toThrow(NotFoundException);
      expect(repo.find).not.toHaveBeenCalled();
    });
  });

  describe('add', () => {
    it('throws NotFoundException when the watch list does not exist', async () => {
      watchListRepo.findOneBy.mockResolvedValue(null);

      await expect(
        service.add({ code: '600000', market: 'A', name: '浦发银行', watchListId: 99 }, 42),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when the watch list belongs to another user', async () => {
      watchListRepo.findOneBy.mockResolvedValue({ id: 1, userId: 99, boardType: 'stock' });

      await expect(
        service.add({ code: '600000', market: 'A', name: '浦发银行', watchListId: 1 }, 42),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when market does not match the list board type', async () => {
      watchListRepo.findOneBy.mockResolvedValue({ id: 1, userId: 42, boardType: 'fund' });

      await expect(
        service.add({ code: '600000', market: 'A', name: '浦发银行', watchListId: 1 }, 42),
      ).rejects.toThrow(BadRequestException);
    });

    it('adds a stock item to a stock-board list with sortOrder scoped to that list', async () => {
      watchListRepo.findOneBy.mockResolvedValue({ id: 1, userId: 42, boardType: 'stock' });
      repo.findOneBy.mockResolvedValue(null);
      repo.findOne.mockResolvedValue({ sortOrder: 2 });

      const result = await service.add(
        { code: '600000', market: 'A', name: '浦发银行', watchListId: 1 },
        42,
      );

      expect(repo.findOne).toHaveBeenCalledWith({
        where: { watchListId: 1 },
        order: { sortOrder: 'DESC' },
      });
      expect(result).toEqual(
        expect.objectContaining({ code: '600000', watchListId: 1, sortOrder: 3 }),
      );
    });

    it('returns the existing favorite without creating a duplicate when one already exists', async () => {
      watchListRepo.findOneBy.mockResolvedValue({ id: 1, userId: 42, boardType: 'stock' });
      const existing = {
        id: 5,
        code: '600000',
        market: 'A',
        name: '浦发银行',
        watchListId: 1,
        sortOrder: 2,
      };
      repo.findOneBy.mockResolvedValue(existing);

      const result = await service.add(
        { code: '600000', market: 'A', name: '浦发银行', watchListId: 1 },
        42,
      );

      expect(repo.findOneBy).toHaveBeenCalledWith({ watchListId: 1, code: '600000', market: 'A' });
      expect(repo.create).not.toHaveBeenCalled();
      expect(result).toBe(existing);
    });

    it('corrects stock name using stocksService if code is passed as name', async () => {
      watchListRepo.findOneBy.mockResolvedValue({ id: 1, userId: 42, boardType: 'stock' });
      repo.findOneBy.mockResolvedValue(null);
      repo.findOne.mockResolvedValue({ sortOrder: 2 });
      stocksService.getInfo.mockResolvedValue({ name: '中国巨石' });

      const result = await service.add(
        { code: '600176', market: 'A', name: '600176', watchListId: 1 },
        42,
      );

      expect(stocksService.getInfo).toHaveBeenCalledWith('A', '600176');
      expect(result.name).toBe('中国巨石');
    });

    it('corrects fund name using fundService if code is passed as name', async () => {
      watchListRepo.findOneBy.mockResolvedValue({ id: 2, userId: 42, boardType: 'fund' });
      repo.findOneBy.mockResolvedValue(null);
      repo.findOne.mockResolvedValue({ sortOrder: 1 });
      fundService.getFundInfo.mockResolvedValue({ name: '万家精选' });

      const result = await service.add(
        { code: '519191', market: 'FUND', name: '519191', watchListId: 2 },
        42,
      );

      expect(fundService.getFundInfo).toHaveBeenCalledWith('519191');
      expect(result.name).toBe('万家精选');
    });
  });

  describe('remove', () => {
    it('throws NotFoundException when the favorite belongs to another user', async () => {
      repo.findOneBy.mockResolvedValue({ id: 5, watchListId: 1 });
      watchListRepo.findOneBy.mockResolvedValue({ id: 1, userId: 99 });

      await expect(service.remove(5, 42)).rejects.toThrow(NotFoundException);
      expect(repo.delete).not.toHaveBeenCalled();
    });

    it('deletes the favorite when owned by the user', async () => {
      repo.findOneBy.mockResolvedValue({ id: 5, watchListId: 1 });
      watchListRepo.findOneBy.mockResolvedValue({ id: 1, userId: 42 });

      await service.remove(5, 42);

      expect(repo.delete).toHaveBeenCalledWith(5);
    });
  });
});
