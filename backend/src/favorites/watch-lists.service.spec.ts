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

  describe('onModuleInit', () => {
    it('creates default lists for stock and fund when none exist', async () => {
      repo.findOne.mockResolvedValue(null);

      await service.onModuleInit();

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ boardType: 'stock', isDefault: true, name: '收藏夹' }),
      );
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ boardType: 'fund', isDefault: true, name: '收藏夹' }),
      );
    });

    it('does not create a default list when one already exists', async () => {
      repo.findOne.mockResolvedValue({
        id: 9,
        boardType: 'stock',
        isDefault: true,
        name: '收藏夹',
      });

      await service.onModuleInit();

      expect(repo.save).not.toHaveBeenCalledWith(expect.objectContaining({ isDefault: true }));
    });

    it('backfills orphan favorites by market into the matching board default list', async () => {
      repo.findOne
        .mockResolvedValueOnce({ id: 10, boardType: 'stock', isDefault: true })
        .mockResolvedValueOnce({ id: 20, boardType: 'fund', isDefault: true });
      favoriteRepo.find.mockResolvedValue([
        { id: 1, market: 'A', watchListId: null },
        { id: 2, market: 'FUND', watchListId: null },
        { id: 3, market: 'HK', watchListId: null },
      ]);

      await service.onModuleInit();

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
    it('queries by boardType ordered by isDefault desc then createdAt asc', async () => {
      repo.find.mockResolvedValue([]);

      await service.findAll('stock');

      expect(repo.find).toHaveBeenCalledWith({
        where: { boardType: 'stock' },
        order: { isDefault: 'DESC', createdAt: 'ASC' },
      });
    });
  });

  describe('create', () => {
    it('creates a non-default list', async () => {
      const result = await service.create({ name: '我的自选股', boardType: 'stock' });

      expect(repo.create).toHaveBeenCalledWith({
        name: '我的自选股',
        boardType: 'stock',
        isDefault: false,
      });
      expect(result).toEqual(
        expect.objectContaining({ name: '我的自选股', boardType: 'stock', isDefault: false }),
      );
    });
  });

  describe('remove', () => {
    it('throws NotFoundException when the list does not exist', async () => {
      repo.findOneBy.mockResolvedValue(null);

      await expect(service.remove(99)).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when removing a default list', async () => {
      repo.findOneBy.mockResolvedValue({ id: 1, isDefault: true });

      await expect(service.remove(1)).rejects.toThrow(BadRequestException);
      expect(repo.delete).not.toHaveBeenCalled();
    });

    it('cascades: deletes favorites in the list then deletes the list', async () => {
      repo.findOneBy.mockResolvedValue({ id: 5, isDefault: false });

      await service.remove(5);

      expect(favoriteRepo.delete).toHaveBeenCalledWith({ watchListId: 5 });
      expect(repo.delete).toHaveBeenCalledWith(5);
    });
  });
});
