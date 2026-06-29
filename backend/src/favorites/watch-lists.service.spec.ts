import { BadRequestException, NotFoundException } from '@nestjs/common';
import { WatchListsService } from './watch-lists.service';

describe('WatchListsService', () => {
  let repo: {
    findOne: jest.Mock;
    findOneBy: jest.Mock;
    find: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    delete: jest.Mock;
  };
  let favoriteRepo: { find: jest.Mock; save: jest.Mock; delete: jest.Mock };
  let service: WatchListsService;

  beforeEach(() => {
    repo = {
      findOne: jest.fn(),
      findOneBy: jest.fn(),
      find: jest.fn(),
      create: jest.fn((data: Record<string, unknown>) => data),
      save: jest.fn((data: Record<string, unknown>) =>
        Promise.resolve({ id: 1, createdAt: new Date(), ...data }),
      ),
      delete: jest.fn(),
    };
    favoriteRepo = {
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn(),
      delete: jest.fn(),
    };
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    service = new WatchListsService(repo as any, favoriteRepo as any);
  });

  describe('migrateLegacyData', () => {
    it('assigns userId to orphan lists and ensures default lists per board', async () => {
      repo.find.mockResolvedValueOnce([
        { id: 3, userId: null, boardType: 'stock' },
        { id: 4, userId: null, boardType: 'fund' },
      ]);
      repo.findOne.mockResolvedValue({ id: 9, isDefault: true });

      await service.migrateLegacyData(42);

      expect(repo.save).toHaveBeenCalledWith([
        expect.objectContaining({ id: 3, userId: 42 }),
        expect.objectContaining({ id: 4, userId: 42 }),
      ]);
    });

    it('creates default lists for stock and fund when none exist', async () => {
      repo.find.mockResolvedValue([]);
      repo.findOne.mockResolvedValue(null);

      await service.migrateLegacyData(42);

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 42,
          boardType: 'stock',
          isDefault: true,
          name: '收藏夹',
        }),
      );
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 42, boardType: 'fund', isDefault: true, name: '收藏夹' }),
      );
    });

    it('backfills orphan favorites by market into the matching board default list', async () => {
      repo.find.mockResolvedValue([]);
      repo.findOne
        .mockResolvedValueOnce({ id: 10, boardType: 'stock', isDefault: true })
        .mockResolvedValueOnce({ id: 20, boardType: 'fund', isDefault: true });
      favoriteRepo.find.mockResolvedValue([
        { id: 1, market: 'A', watchListId: null },
        { id: 2, market: 'FUND', watchListId: null },
        { id: 3, market: 'HK', watchListId: null },
      ]);

      await service.migrateLegacyData(42);

      expect(favoriteRepo.save).toHaveBeenCalledWith([
        expect.objectContaining({ id: 1, watchListId: 10 }),
        expect.objectContaining({ id: 3, watchListId: 10 }),
      ]);
      expect(favoriteRepo.save).toHaveBeenCalledWith([
        expect.objectContaining({ id: 2, watchListId: 20 }),
      ]);
    });
  });

  describe('findAll', () => {
    it('ensures a default list then queries by user and boardType', async () => {
      repo.findOne.mockResolvedValue({ id: 9, isDefault: true });
      repo.find.mockResolvedValue([]);

      await service.findAll(42, 'stock');

      expect(repo.find).toHaveBeenCalledWith({
        where: { userId: 42, boardType: 'stock' },
        order: { isDefault: 'DESC', createdAt: 'ASC' },
      });
    });
  });

  describe('create', () => {
    it('creates a non-default list scoped to the user', async () => {
      const result = await service.create({ userId: 42, name: '我的自选股', boardType: 'stock' });

      expect(repo.create).toHaveBeenCalledWith({
        userId: 42,
        name: '我的自选股',
        boardType: 'stock',
        isDefault: false,
      });
      expect(result).toEqual(
        expect.objectContaining({ userId: 42, name: '我的自选股', boardType: 'stock' }),
      );
    });
  });

  describe('remove', () => {
    it('throws NotFoundException when the list does not exist', async () => {
      repo.findOneBy.mockResolvedValue(null);

      await expect(service.remove(99, 42)).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when the list belongs to another user', async () => {
      repo.findOneBy.mockResolvedValue({ id: 5, userId: 7, isDefault: false });

      await expect(service.remove(5, 42)).rejects.toThrow(NotFoundException);
      expect(repo.delete).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when removing a default list', async () => {
      repo.findOneBy.mockResolvedValue({ id: 1, userId: 42, isDefault: true });

      await expect(service.remove(1, 42)).rejects.toThrow(BadRequestException);
      expect(repo.delete).not.toHaveBeenCalled();
    });

    it('cascades: deletes favorites in the list then deletes the list', async () => {
      repo.findOneBy.mockResolvedValue({ id: 5, userId: 42, isDefault: false });

      await service.remove(5, 42);

      expect(favoriteRepo.delete).toHaveBeenCalledWith({ watchListId: 5 });
      expect(repo.delete).toHaveBeenCalledWith(5);
    });
  });
});
