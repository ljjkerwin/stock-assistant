import { BadRequestException, NotFoundException } from '@nestjs/common';
import { FavoritesService } from './favorites.service';

describe('FavoritesService', () => {
  let repo: {
    find: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    count: jest.Mock;
    delete: jest.Mock;
    findOneBy: jest.Mock;
  };
  let watchListRepo: { findOneBy: jest.Mock };

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
    };
    watchListRepo = { findOneBy: jest.fn() };
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    service = new FavoritesService(repo as any, watchListRepo as any);
  });

  describe('findAll', () => {
    it('filters favorites by watchListId', async () => {
      repo.find.mockResolvedValue([]);

      await service.findAll(7);

      expect(repo.find).toHaveBeenCalledWith({
        where: { watchListId: 7 },
        order: { pinned: 'DESC', sortOrder: 'ASC', createdAt: 'ASC' },
      });
    });
  });

  describe('add', () => {
    it('throws NotFoundException when the watch list does not exist', async () => {
      watchListRepo.findOneBy.mockResolvedValue(null);

      await expect(
        service.add({ code: '600000', market: 'A', name: '浦发银行', watchListId: 99 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when market does not match the list board type', async () => {
      watchListRepo.findOneBy.mockResolvedValue({ id: 1, boardType: 'fund' });

      await expect(
        service.add({ code: '600000', market: 'A', name: '浦发银行', watchListId: 1 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('adds a stock item to a stock-board list with sortOrder scoped to that list', async () => {
      watchListRepo.findOneBy.mockResolvedValue({ id: 1, boardType: 'stock' });
      repo.findOneBy.mockResolvedValue(null);
      repo.count.mockResolvedValue(3);

      const result = await service.add({
        code: '600000',
        market: 'A',
        name: '浦发银行',
        watchListId: 1,
      });

      expect(repo.count).toHaveBeenCalledWith({ where: { watchListId: 1 } });
      expect(result).toEqual(
        expect.objectContaining({ code: '600000', watchListId: 1, sortOrder: 3 }),
      );
    });

    it('adds a fund item to a fund-board list', async () => {
      watchListRepo.findOneBy.mockResolvedValue({ id: 2, boardType: 'fund' });
      repo.findOneBy.mockResolvedValue(null);

      const result = await service.add({
        code: '000001',
        market: 'FUND',
        name: '示例基金',
        watchListId: 2,
      });

      expect(result).toEqual(expect.objectContaining({ market: 'FUND', watchListId: 2 }));
    });

    it('returns the existing favorite without creating a duplicate when one already exists in the list', async () => {
      watchListRepo.findOneBy.mockResolvedValue({ id: 1, boardType: 'stock' });
      const existing = {
        id: 5,
        code: '600000',
        market: 'A',
        name: '浦发银行',
        watchListId: 1,
        sortOrder: 2,
      };
      repo.findOneBy.mockResolvedValue(existing);

      const result = await service.add({
        code: '600000',
        market: 'A',
        name: '浦发银行',
        watchListId: 1,
      });

      expect(repo.findOneBy).toHaveBeenCalledWith({ watchListId: 1, code: '600000', market: 'A' });
      expect(repo.create).not.toHaveBeenCalled();
      expect(repo.save).not.toHaveBeenCalled();
      expect(repo.count).not.toHaveBeenCalled();
      expect(result).toBe(existing);
    });
  });
});
