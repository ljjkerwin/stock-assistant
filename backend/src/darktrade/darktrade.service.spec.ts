import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import axios from 'axios';
import { Subject } from 'rxjs';
import { DarkTradeService } from './darktrade.service';
import { DarkTradeIndex } from './dark-trade-index.entity';
import { DarkTradeSnapshot } from './dark-trade-snapshot.entity';
import { DarkTradeDailyResult } from './dark-trade-daily-result.entity';
import { Favorite } from '../favorites/favorite.entity';
import { SchedulerService } from '../scheduler/scheduler.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('DarkTradeService', () => {
  let service: DarkTradeService;
  let indexRepo: {
    count: jest.Mock;
    findOne: jest.Mock;
    find: jest.Mock;
    clear: jest.Mock;
    insert: jest.Mock;
  };
  let snapshotRepo: {
    find: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let dailyResultRepo: {
    find: jest.Mock;
    upsert: jest.Mock;
  };
  let favoriteRepo: {
    find: jest.Mock;
  };
  let schedulerService: {
    tick$: Subject<number>;
    minute$: Subject<Date>;
  };

  // Helper mocks for QueryBuilder
  let insertValuesMock: jest.Mock;
  let orUpdateMock: jest.Mock;
  let updateEntityMock: jest.Mock;
  let executeMock: jest.Mock;
  let getManyMock: jest.Mock;

  beforeEach(async () => {
    indexRepo = {
      count: jest.fn(),
      findOne: jest.fn(),
      find: jest.fn(),
      clear: jest.fn(),
      insert: jest.fn(),
    };

    insertValuesMock = jest.fn().mockReturnThis();
    orUpdateMock = jest.fn().mockReturnThis();
    updateEntityMock = jest.fn().mockReturnThis();
    executeMock = jest.fn().mockResolvedValue({} as any);
    getManyMock = jest.fn().mockResolvedValue([]);

    const qbMock = {
      insert: jest.fn().mockReturnThis(),
      into: jest.fn().mockReturnThis(),
      values: insertValuesMock,
      orUpdate: orUpdateMock,
      updateEntity: updateEntityMock,
      execute: executeMock,
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: getManyMock,
    };

    snapshotRepo = {
      find: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue(qbMock),
    };

    dailyResultRepo = {
      find: jest.fn(),
      upsert: jest.fn(),
    };

    favoriteRepo = {
      find: jest.fn(),
    };

    schedulerService = {
      tick$: new Subject<number>(),
      minute$: new Subject<Date>(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DarkTradeService,
        {
          provide: getRepositoryToken(DarkTradeIndex),
          useValue: indexRepo,
        },
        {
          provide: getRepositoryToken(DarkTradeSnapshot),
          useValue: snapshotRepo,
        },
        {
          provide: getRepositoryToken(DarkTradeDailyResult),
          useValue: dailyResultRepo,
        },
        {
          provide: getRepositoryToken(Favorite),
          useValue: favoriteRepo,
        },
        {
          provide: SchedulerService,
          useValue: schedulerService,
        },
      ],
    }).compile();

    service = module.get<DarkTradeService>(DarkTradeService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getSnapshotsBatch and Noon Break Mapping', () => {
    const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');

    it('triggers live data fetch and maps noon break times to 11:30', async () => {
      // Mock index status
      indexRepo.count.mockResolvedValue(10);
      indexRepo.findOne.mockResolvedValue({ refreshDate: todayStr });

      // Mock index search to return page 1
      indexRepo.find.mockResolvedValue([{ code: '600176', pageNum: 1, sortFlag: 4, sortDesc: 1 }]);

      // Mock axios response for the first page
      mockedAxios.get.mockResolvedValue({
        data: Buffer.from(
          JSON.stringify({
            errid: 0,
            errmsg: '',
            1: 1,
            2: 1,
            data: [
              {
                3: 1,
                4: '600176',
                6: 100000, // darkCapital
                7: 200000, // lightCapital
                8: 300000,
                11: 0.5,
                13: 10000,
                14: 0.05,
                16: 'TEST_STOCK',
                17: 'Sector',
                18: 'Concept',
              },
            ],
          }),
        ),
      });

      // Mock current time to be 12:15 PM (noon break)
      const mockDate = new Date();
      // Beijing time 12:15 is UTC 04:15
      mockDate.setUTCHours(4);
      mockDate.setUTCMinutes(15);
      jest.useFakeTimers();
      jest.setSystemTime(mockDate);

      // Call getSnapshotsBatch for today
      await service.getSnapshotsBatch(['600176'], todayStr);

      // Verify that snapshots insertion was triggered with captureMinute mapped to 11:30
      expect(insertValuesMock).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            code: '600176',
            tradeDate: todayStr,
            captureMinute: `${todayStr}1130`,
          }),
        ]),
      );

      jest.useRealTimers();
    });

    it('maps after close times to 15:00', async () => {
      indexRepo.count.mockResolvedValue(10);
      indexRepo.findOne.mockResolvedValue({ refreshDate: todayStr });
      indexRepo.find.mockResolvedValue([{ code: '600176', pageNum: 1, sortFlag: 4, sortDesc: 1 }]);

      mockedAxios.get.mockResolvedValue({
        data: Buffer.from(
          JSON.stringify({
            errid: 0,
            errmsg: '',
            1: 1,
            2: 1,
            data: [{ 3: 1, 4: '600176', 6: 100000, 7: 200000 }],
          }),
        ),
      });

      // Mock current time to 4:00 PM Beijing time (UTC 8:00)
      const mockDate = new Date();
      mockDate.setUTCHours(8);
      mockDate.setUTCMinutes(0);
      jest.useFakeTimers();
      jest.setSystemTime(mockDate);

      await service.getSnapshotsBatch(['600176'], todayStr);

      expect(insertValuesMock).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            captureMinute: `${todayStr}1500`,
          }),
        ]),
      );

      jest.useRealTimers();
    });

    it('uses standard time format for normal trading hours', async () => {
      indexRepo.count.mockResolvedValue(10);
      indexRepo.findOne.mockResolvedValue({ refreshDate: todayStr });
      indexRepo.find.mockResolvedValue([{ code: '600176', pageNum: 1, sortFlag: 4, sortDesc: 1 }]);

      mockedAxios.get.mockResolvedValue({
        data: Buffer.from(
          JSON.stringify({
            errid: 0,
            errmsg: '',
            1: 1,
            2: 1,
            data: [{ 3: 1, 4: '600176', 6: 100000, 7: 200000 }],
          }),
        ),
      });

      // Mock current time to 10:15 AM Beijing time (UTC 2:15)
      const mockDate = new Date();
      mockDate.setUTCHours(2);
      mockDate.setUTCMinutes(15);
      jest.useFakeTimers();
      jest.setSystemTime(mockDate);

      await service.getSnapshotsBatch(['600176'], todayStr);

      expect(insertValuesMock).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            captureMinute: `${todayStr}1015`,
          }),
        ]),
      );

      jest.useRealTimers();
    });
  });

  describe('getDiscoveryStocks', () => {
    it('returns only stocks whose dark capital clears both discovery thresholds', async () => {
      dailyResultRepo.find.mockResolvedValue([
        {
          code: 'A',
          name: '符合但较小',
          darkCapital: 30_000_000,
          lightCapital: 10_000_000,
          tradeDate: '20260728',
          captureMinute: '202607281500',
        },
        {
          code: 'B',
          name: '符合且较大',
          darkCapital: 60_000_000,
          lightCapital: 20_000_000,
          tradeDate: '20260728',
          captureMinute: '202607281500',
        },
        {
          code: 'C',
          name: '暗盘不足',
          darkCapital: 20_000_000,
          lightCapital: 1_000_000,
          tradeDate: '20260728',
          captureMinute: '202607281500',
        },
        {
          code: 'D',
          name: '倍率不足',
          darkCapital: 30_000_000,
          lightCapital: 15_000_000,
          tradeDate: '20260728',
          captureMinute: '202607281500',
        },
        {
          code: 'E',
          name: '缺少明盘',
          darkCapital: 30_000_000,
          lightCapital: null,
          tradeDate: '20260728',
          captureMinute: '202607281500',
        },
        {
          code: 'F',
          name: '负明盘绝对值倍率不足',
          darkCapital: 30_000_000,
          lightCapital: -20_000_000,
          tradeDate: '20260728',
          captureMinute: '202607281500',
        },
      ]);

      const result = await service.getDiscoveryStocks();

      expect(result.map((item) => item.code)).toEqual(['B', 'A']);
    });

    it('applies caller-supplied discovery thresholds', async () => {
      dailyResultRepo.find.mockResolvedValue([
        {
          code: 'A',
          name: '倍率符合但金额不足',
          darkCapital: 30_000_000,
          lightCapital: 10_000_000,
          tradeDate: '20260728',
          captureMinute: '202607281500',
        },
        {
          code: 'B',
          name: '符合',
          darkCapital: 60_000_000,
          lightCapital: 20_000_000,
          tradeDate: '20260728',
          captureMinute: '202607281500',
        },
      ]);

      const result = await service.getDiscoveryStocks(50_000_000, 2.5);

      expect(result.map((item) => item.code)).toEqual(['B']);
    });
  });
});
