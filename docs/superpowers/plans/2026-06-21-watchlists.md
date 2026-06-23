# 标的列表（多收藏夹）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在「收藏夹」之外支持用户按板块（股票/基金）维护多个自定义标的列表，通过侧边栏下拉框 + 「+」新建、🗑 删除自定义列表，并在详情页提供「加入列表」入口。

**Architecture:** 后端新增 `WatchList` 实体（按板块各保留一个不可删除的默认「收藏夹」），`Favorite` 实体新增 `watchListId` 外键列，将原本全局单一的收藏列表改为「列表 → 标的」一对多结构。前端用一个新 `watchListStore` 管理列表的增删切换，原 `favoritesStore` 由「单一全局数组」改造为「按 `watchListId` 缓存的标的集合」，Sidebar 渲染当前选中列表的内容，详情页 ☆ 按钮固定操作默认列表、新增「加入列表」下拉菜单操作自定义列表。

**Tech Stack:** NestJS + TypeORM（better-sqlite3 / MySQL，`synchronize: true`）、React 19 + Zustand + Ant Design 6、Jest（后端）、Vitest（前端）。

## Global Constraints

- 项目使用 `synchronize: true`，无正式 migration；新增字段/表通过启动时的自举逻辑（`OnModuleInit`）完成数据迁移，不依赖手写 SQL migration 文件。
- 前端 git pre-commit 钩子在任何 `frontend/` 文件变更时，对**整个前端项目**运行 `tsc --noEmit`；后端同理对**整个后端项目**运行 `tsc --noEmit`。因此每个任务结束提交时，必须保证对应项目整体可编译通过，不能留下半成品的破坏性签名变更。
- 不引入新的 npm 依赖（不安装 `@testing-library/react`等）；前端 UI 改动通过启动 dev server 手动验证，不新增组件测试基础设施。
- 详情页 ☆ 收藏按钮语义保持不变：始终只读写对应板块的默认「收藏夹」列表。
- `StockListImport` 页面不接入自定义列表，悬浮添加按钮固定操作 stock 板块默认列表。

---

## Task 1: 后端 — WatchList 列表管理（实体 + service + controller + 自举迁移）

**Files:**
- Create: `backend/src/favorites/watch-list.entity.ts`
- Create: `backend/src/favorites/watch-lists.service.ts`
- Create: `backend/src/favorites/watch-lists.controller.ts`
- Create: `backend/src/favorites/watch-lists.service.spec.ts`
- Modify: `backend/src/favorites/favorites.module.ts`
- Modify: `backend/src/app.module.ts`

**Interfaces:**
- Produces: `WatchList` 实体（`id, name, boardType: 'stock' | 'fund', isDefault: boolean, createdAt: Date`）；`WatchListsService`（`findAll(boardType)`, `create(data)`, `remove(id)`，及 `OnModuleInit` 自举逻辑）；`WatchListsController`（`GET/POST /api/watchlists`, `DELETE /api/watchlists/:id`）；导出类型 `BoardType = 'stock' | 'fund'`
- Consumes: 无（本任务不依赖前序任务）

- [ ] **Step 1: 创建 `WatchList` 实体**

```ts
// backend/src/favorites/watch-list.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('watch_lists')
export class WatchList {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @Column({ name: 'board_type' })
  boardType: 'stock' | 'fund';

  @Column({ name: 'is_default', default: false })
  isDefault: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
```

- [ ] **Step 2: 写 `WatchListsService` 的失败测试**

```ts
// backend/src/favorites/watch-lists.service.spec.ts
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
      create: jest.fn((data) => data),
      save: jest.fn(async (data) => ({ id: 1, createdAt: new Date(), ...data })),
      delete: jest.fn(),
    };
    favoriteRepo = {
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn(),
      delete: jest.fn(),
    };
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
      repo.findOne.mockResolvedValue({ id: 9, boardType: 'stock', isDefault: true, name: '收藏夹' });

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
```

- [ ] **Step 3: 运行测试确认失败（找不到模块）**

Run: `cd backend && pnpm exec jest watch-lists.service.spec.ts`
Expected: FAIL，报错 `Cannot find module './watch-lists.service'`

- [ ] **Step 4: 实现 `WatchListsService`**

```ts
// backend/src/favorites/watch-lists.service.ts
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
```

- [ ] **Step 5: 在 `Favorite` 实体上临时补充 `watchListId` 字段以便本任务编译通过**

本任务的测试 mock 直接操作 `Favorite` 形状的普通对象，不要求真实实体已有该列；但 `WatchListsService` 源码中 `f.watchListId = defaultListId` 与 `IsNull()` 查询都需要 `Favorite` 实体存在 `watchListId` 属性，否则 `tsc --noEmit` 会报类型错误。在 `backend/src/favorites/favorite.entity.ts` 末尾字段前新增：

```ts
// backend/src/favorites/favorite.entity.ts
// 在 `name` 字段之后、`sortOrder` 字段之前插入：
  @Column({ name: 'watch_list_id', nullable: true })
  watchListId: number | null;
```

完整文件此时应为：

```ts
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('favorites')
export class Favorite {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  code: string;

  @Column()
  market: string;

  @Column()
  name: string;

  @Column({ name: 'watch_list_id', nullable: true })
  watchListId: number | null;

  @Column({ name: 'sort_order', default: 0 })
  sortOrder: number;

  @Column({ default: false })
  pinned: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
```

（Task 2 会基于这个字段继续改造 `FavoritesService`/`FavoritesController`，这里只是让实体形状到位。）

- [ ] **Step 6: 运行测试确认通过**

Run: `cd backend && pnpm exec jest watch-lists.service.spec.ts`
Expected: PASS（7 个测试用例全部通过）

- [ ] **Step 7: 实现 `WatchListsController`**

```ts
// backend/src/favorites/watch-lists.controller.ts
import { Controller, Get, Post, Delete, Param, Body, Query, ParseIntPipe } from '@nestjs/common';
import { WatchListsService, BoardType } from './watch-lists.service';

@Controller('api/watchlists')
export class WatchListsController {
  constructor(private readonly service: WatchListsService) {}

  @Get()
  findAll(@Query('boardType') boardType: BoardType) {
    return this.service.findAll(boardType);
  }

  @Post()
  create(@Body() body: { name: string; boardType: BoardType }) {
    return this.service.create(body);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }
}
```

- [ ] **Step 8: 注册到 `FavoritesModule`**

```ts
// backend/src/favorites/favorites.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Favorite } from './favorite.entity';
import { WatchList } from './watch-list.entity';
import { FavoritesService } from './favorites.service';
import { FavoritesController } from './favorites.controller';
import { WatchListsService } from './watch-lists.service';
import { WatchListsController } from './watch-lists.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Favorite, WatchList])],
  providers: [FavoritesService, WatchListsService],
  controllers: [FavoritesController, WatchListsController],
})
export class FavoritesModule {}
```

- [ ] **Step 9: 在 `app.module.ts` 注册 `WatchList` 实体**

```ts
// backend/src/app.module.ts
// 在现有 import 区块新增：
import { WatchList } from './favorites/watch-list.entity';

// 修改 entities 数组：
const entities = [Favorite, WatchList, MonitorRule, MonitorMessage];
```

- [ ] **Step 10: 全量校验**

Run: `cd backend && pnpm exec tsc --noEmit && pnpm exec jest`
Expected: 类型检查通过；全部测试套件（含已有的 `cache.spec.ts`、`kline.service.spec.ts` 等）通过

- [ ] **Step 11: Commit**

```bash
git add backend/src/favorites/watch-list.entity.ts backend/src/favorites/watch-lists.service.ts backend/src/favorites/watch-lists.controller.ts backend/src/favorites/watch-lists.service.spec.ts backend/src/favorites/favorites.module.ts backend/src/favorites/favorite.entity.ts backend/src/app.module.ts
git commit -m "feat: 新增标的列表（WatchList）管理接口与启动自举迁移"
```

---

## Task 2: 后端 — Favorites 按列表隔离（实体字段已就绪，改造 service/controller）

**Files:**
- Modify: `backend/src/favorites/favorites.service.ts`
- Modify: `backend/src/favorites/favorites.controller.ts`
- Create: `backend/src/favorites/favorites.service.spec.ts`

**Interfaces:**
- Consumes: `WatchList` 实体（Task 1 创建，字段 `id, boardType: 'stock' | 'fund'`）；`Favorite.watchListId: number | null`（Task 1 Step 5 已加好）
- Produces: `FavoritesService.findAll(watchListId: number)`、`FavoritesService.add(data: { code, market, name, watchListId })`（market 与列表板块不匹配时抛 `BadRequestException`）；`GET /api/favorites?watchListId=` 替代原无参数版本

- [ ] **Step 1: 写 `FavoritesService` 的失败测试**

```ts
// backend/src/favorites/favorites.service.spec.ts
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
      create: jest.fn((data) => data),
      save: jest.fn(async (data) => ({ id: 1, ...data })),
      count: jest.fn().mockResolvedValue(0),
      delete: jest.fn(),
      findOneBy: jest.fn(),
    };
    watchListRepo = { findOneBy: jest.fn() };
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

      const result = await service.add({
        code: '000001',
        market: 'FUND',
        name: '示例基金',
        watchListId: 2,
      });

      expect(result).toEqual(expect.objectContaining({ market: 'FUND', watchListId: 2 }));
    });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && pnpm exec jest favorites.service.spec.ts`
Expected: FAIL — `FavoritesService` 构造函数当前只接受一个参数，且 `findAll`/`add` 签名不匹配

- [ ] **Step 3: 改造 `FavoritesService`**

```ts
// backend/src/favorites/favorites.service.ts
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
      throw new BadRequestException(
        `标的市场 ${data.market} 与列表板块 ${list.boardType} 不匹配`,
      );
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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd backend && pnpm exec jest favorites.service.spec.ts`
Expected: PASS（5 个测试用例全部通过）

- [ ] **Step 5: 改造 `FavoritesController`**

```ts
// backend/src/favorites/favorites.controller.ts
import { Controller, Get, Post, Delete, Patch, Param, Body, Query, ParseIntPipe } from '@nestjs/common';
import { FavoritesService } from './favorites.service';

@Controller('api/favorites')
export class FavoritesController {
  constructor(private readonly service: FavoritesService) {}

  @Get()
  findAll(@Query('watchListId', ParseIntPipe) watchListId: number) {
    return this.service.findAll(watchListId);
  }

  @Post()
  add(@Body() body: { code: string; market: string; name: string; watchListId: number }) {
    return this.service.add(body);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { sortOrder?: number; pinned?: boolean },
  ) {
    return this.service.update(id, body);
  }
}
```

- [ ] **Step 6: 全量校验**

Run: `cd backend && pnpm exec tsc --noEmit && pnpm exec jest`
Expected: 类型检查通过；全部测试套件通过

- [ ] **Step 7: Commit**

```bash
git add backend/src/favorites/favorites.service.ts backend/src/favorites/favorites.controller.ts backend/src/favorites/favorites.service.spec.ts
git commit -m "feat: Favorites 接口按 watchListId 隔离，新增板块校验"
```

---

## Task 3: 前端 — 多列表收藏（store 层 + 全部 UI 接入）

> 前端 pre-commit 钩子对整个前端项目运行 `tsc --noEmit`，而 `favoritesStore` 的对外签名是破坏性变更（`favorites: Stock[]` → `itemsByList: Record<number, Stock[]>`），所有消费方必须在同一次提交内一起改完，否则编译不过。本任务把 store 层与全部 5 个消费方（Sidebar、StockDetail、FundDetail、StrategyBacktest、StockListImport）放在一个任务里，按步骤推进，最后统一提交一次。

**Files:**
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/api/stock.ts`
- Create: `frontend/src/store/watchListStore.ts`
- Create: `frontend/src/store/watchListStore.spec.ts`
- Modify: `frontend/src/store/favoritesStore.ts`
- Create: `frontend/src/store/favoritesStore.spec.ts`
- Modify: `frontend/src/components/Sidebar/index.tsx`
- Modify: `frontend/src/components/Sidebar/Sidebar.module.css`
- Create: `frontend/src/components/AddToListMenu/index.tsx`
- Modify: `frontend/src/pages/StockDetail/index.tsx`
- Modify: `frontend/src/pages/FundDetail/index.tsx`
- Modify: `frontend/src/pages/StrategyBacktest/index.tsx`
- Modify: `frontend/src/pages/StockListImport/index.tsx`

**Interfaces:**
- Consumes: 后端 `GET/POST /api/watchlists`、`DELETE /api/watchlists/:id`、`GET /api/favorites?watchListId=`、`POST /api/favorites`（body 含 `watchListId`）（均来自 Task 1、Task 2）
- Produces:
  - `WatchList` 类型、`BoardType = 'stock' | 'fund'` 类型
  - `watchListsApi.list/create/remove`
  - `favoritesApi.list(watchListId)`、`favoritesApi.add(stock & { watchListId })`
  - `useWatchListStore`：`stockLists, fundLists, currentStockListId, currentFundListId, fetchLists, createList, deleteList, setCurrentList`
  - `useFavoritesStore`：`itemsByList, fetchList, addToList, removeItem, reorder, pin`
  - `<AddToListMenu boardType stock />` 组件

### Step 1: 新增类型

```ts
// frontend/src/types/index.ts
// 在文件末尾追加：

export type BoardType = 'stock' | 'fund';

export interface WatchList {
  id: number;
  name: string;
  boardType: BoardType;
  isDefault: boolean;
}
```

- [ ] 完成上述修改

### Step 2: 改造 `api/stock.ts`

```ts
// frontend/src/api/stock.ts
// 顶部 import 增加 WatchList、BoardType：
import type {
  Stock,
  StockInfo,
  KlineResponse,
  KlinePeriod,
  KlineBar,
  MonitorRule,
  MonitorMessage,
  FundInfo,
  FundNavResponse,
  FundSearchResult,
  FundHoldingPeriod,
  WatchList,
  BoardType,
} from '../types';

// 替换原 favoritesApi：
export const favoritesApi = {
  list: (watchListId: number) =>
    api.get<Stock[]>('/favorites', { params: { watchListId } }).then((r) => r.data),
  add: (stock: { code: string; market: 'A' | 'HK' | 'FUND'; name: string; watchListId: number }) =>
    api.post<Stock>('/favorites', stock).then((r) => r.data),
  remove: (id: number) => api.delete(`/favorites/${id}`),
  update: (id: number, data: { sortOrder?: number; pinned?: boolean }) =>
    api.patch<Stock>(`/favorites/${id}`, data).then((r) => r.data),
};

// 在 favoritesApi 之后新增：
export const watchListsApi = {
  list: (boardType: BoardType): Promise<WatchList[]> =>
    api.get<WatchList[]>('/watchlists', { params: { boardType } }).then((r) => r.data),
  create: (name: string, boardType: BoardType): Promise<WatchList> =>
    api.post<WatchList>('/watchlists', { name, boardType }).then((r) => r.data),
  remove: (id: number): Promise<void> => api.delete(`/watchlists/${id}`).then(() => undefined),
};
```

- [ ] 完成上述修改

### Step 3: 写 `watchListStore` 的失败测试

```ts
// frontend/src/store/watchListStore.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useWatchListStore } from './watchListStore';
import { watchListsApi } from '../api/stock';
import type { WatchList } from '../types';

vi.mock('../api/stock', () => ({
  watchListsApi: {
    list: vi.fn(),
    create: vi.fn(),
    remove: vi.fn(),
  },
}));

describe('watchListStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWatchListStore.setState({
      stockLists: [],
      fundLists: [],
      currentStockListId: null,
      currentFundListId: null,
    });
  });

  describe('fetchLists', () => {
    it('populates stockLists and selects the default list when no current selection', async () => {
      const lists: WatchList[] = [
        { id: 1, name: '我的自选股', boardType: 'stock', isDefault: false },
        { id: 2, name: '收藏夹', boardType: 'stock', isDefault: true },
      ];
      vi.mocked(watchListsApi.list).mockResolvedValue(lists);

      await useWatchListStore.getState().fetchLists('stock');

      const state = useWatchListStore.getState();
      expect(state.stockLists).toEqual(lists);
      expect(state.currentStockListId).toBe(2);
    });

    it('keeps the current selection if it still exists after refetch', async () => {
      useWatchListStore.setState({ currentStockListId: 1 });
      const lists: WatchList[] = [
        { id: 1, name: '我的自选股', boardType: 'stock', isDefault: false },
        { id: 2, name: '收藏夹', boardType: 'stock', isDefault: true },
      ];
      vi.mocked(watchListsApi.list).mockResolvedValue(lists);

      await useWatchListStore.getState().fetchLists('stock');

      expect(useWatchListStore.getState().currentStockListId).toBe(1);
    });
  });

  describe('createList', () => {
    it('appends the new list and selects it as current', async () => {
      const created: WatchList = { id: 3, name: '打新观察', boardType: 'fund', isDefault: false };
      vi.mocked(watchListsApi.create).mockResolvedValue(created);

      const result = await useWatchListStore.getState().createList('打新观察', 'fund');

      expect(watchListsApi.create).toHaveBeenCalledWith('打新观察', 'fund');
      expect(result).toEqual(created);
      const state = useWatchListStore.getState();
      expect(state.fundLists).toEqual([created]);
      expect(state.currentFundListId).toBe(3);
    });
  });

  describe('deleteList', () => {
    it('removes the list and falls back to the default when the deleted list was selected', async () => {
      useWatchListStore.setState({
        stockLists: [
          { id: 1, name: '我的自选股', boardType: 'stock', isDefault: false },
          { id: 2, name: '收藏夹', boardType: 'stock', isDefault: true },
        ],
        currentStockListId: 1,
      });
      vi.mocked(watchListsApi.remove).mockResolvedValue(undefined);

      await useWatchListStore.getState().deleteList(1, 'stock');

      expect(watchListsApi.remove).toHaveBeenCalledWith(1);
      const state = useWatchListStore.getState();
      expect(state.stockLists).toEqual([{ id: 2, name: '收藏夹', boardType: 'stock', isDefault: true }]);
      expect(state.currentStockListId).toBe(2);
    });

    it('keeps the current selection when a different list is deleted', async () => {
      useWatchListStore.setState({
        stockLists: [
          { id: 1, name: '我的自选股', boardType: 'stock', isDefault: false },
          { id: 2, name: '收藏夹', boardType: 'stock', isDefault: true },
        ],
        currentStockListId: 2,
      });
      vi.mocked(watchListsApi.remove).mockResolvedValue(undefined);

      await useWatchListStore.getState().deleteList(1, 'stock');

      expect(useWatchListStore.getState().currentStockListId).toBe(2);
    });
  });
});
```

- [ ] 完成上述测试文件

### Step 4: 运行测试确认失败

Run: `cd frontend && pnpm exec vitest run watchListStore.spec.ts`
Expected: FAIL — 找不到模块 `./watchListStore`

- [ ] 确认失败信息符合预期

### Step 5: 实现 `watchListStore`

```ts
// frontend/src/store/watchListStore.ts
import { create } from 'zustand';
import type { WatchList, BoardType } from '../types';
import { watchListsApi } from '../api/stock';

interface WatchListStore {
  stockLists: WatchList[];
  fundLists: WatchList[];
  currentStockListId: number | null;
  currentFundListId: number | null;
  fetchLists: (boardType: BoardType) => Promise<void>;
  createList: (name: string, boardType: BoardType) => Promise<WatchList>;
  deleteList: (id: number, boardType: BoardType) => Promise<void>;
  setCurrentList: (boardType: BoardType, id: number) => void;
}

function pickDefaultId(lists: WatchList[]): number | null {
  return lists.find((l) => l.isDefault)?.id ?? lists[0]?.id ?? null;
}

export const useWatchListStore = create<WatchListStore>((set, get) => ({
  stockLists: [],
  fundLists: [],
  currentStockListId: null,
  currentFundListId: null,

  fetchLists: async (boardType) => {
    const lists = await watchListsApi.list(boardType);
    if (boardType === 'stock') {
      const current = get().currentStockListId;
      const stillExists = current != null && lists.some((l) => l.id === current);
      set({ stockLists: lists, currentStockListId: stillExists ? current : pickDefaultId(lists) });
    } else {
      const current = get().currentFundListId;
      const stillExists = current != null && lists.some((l) => l.id === current);
      set({ fundLists: lists, currentFundListId: stillExists ? current : pickDefaultId(lists) });
    }
  },

  createList: async (name, boardType) => {
    const created = await watchListsApi.create(name, boardType);
    if (boardType === 'stock') {
      set((s) => ({ stockLists: [...s.stockLists, created], currentStockListId: created.id }));
    } else {
      set((s) => ({ fundLists: [...s.fundLists, created], currentFundListId: created.id }));
    }
    return created;
  },

  deleteList: async (id, boardType) => {
    await watchListsApi.remove(id);
    if (boardType === 'stock') {
      set((s) => {
        const remaining = s.stockLists.filter((l) => l.id !== id);
        return {
          stockLists: remaining,
          currentStockListId: s.currentStockListId === id ? pickDefaultId(remaining) : s.currentStockListId,
        };
      });
    } else {
      set((s) => {
        const remaining = s.fundLists.filter((l) => l.id !== id);
        return {
          fundLists: remaining,
          currentFundListId: s.currentFundListId === id ? pickDefaultId(remaining) : s.currentFundListId,
        };
      });
    }
  },

  setCurrentList: (boardType, id) => {
    if (boardType === 'stock') {
      set({ currentStockListId: id });
    } else {
      set({ currentFundListId: id });
    }
  },
}));
```

- [ ] 完成上述实现

### Step 6: 运行测试确认通过

Run: `cd frontend && pnpm exec vitest run watchListStore.spec.ts`
Expected: PASS（5 个测试用例全部通过）

- [ ] 确认通过

### Step 7: 写 `favoritesStore` 的失败测试（替换旧实现）

```ts
// frontend/src/store/favoritesStore.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useFavoritesStore } from './favoritesStore';
import { favoritesApi } from '../api/stock';
import type { Stock } from '../types';

vi.mock('../api/stock', () => ({
  favoritesApi: {
    list: vi.fn(),
    add: vi.fn(),
    remove: vi.fn(),
    update: vi.fn(),
  },
}));

describe('favoritesStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useFavoritesStore.setState({ itemsByList: {} });
  });

  describe('fetchList', () => {
    it('fetches items for a list and caches them by watchListId', async () => {
      const items: Stock[] = [{ id: 1, code: '600000', market: 'A', name: '浦发银行' }];
      vi.mocked(favoritesApi.list).mockResolvedValue(items);

      await useFavoritesStore.getState().fetchList(7);

      expect(favoritesApi.list).toHaveBeenCalledWith(7);
      expect(useFavoritesStore.getState().itemsByList[7]).toEqual(items);
    });
  });

  describe('addToList', () => {
    it('posts the stock with the target watchListId then refetches that list', async () => {
      vi.mocked(favoritesApi.add).mockResolvedValue({
        id: 1,
        code: '600000',
        market: 'A',
        name: '浦发银行',
      } as Stock);
      vi.mocked(favoritesApi.list).mockResolvedValue([
        { id: 1, code: '600000', market: 'A', name: '浦发银行' },
      ]);

      await useFavoritesStore.getState().addToList(7, { code: '600000', market: 'A', name: '浦发银行' });

      expect(favoritesApi.add).toHaveBeenCalledWith({
        code: '600000',
        market: 'A',
        name: '浦发银行',
        watchListId: 7,
      });
      expect(useFavoritesStore.getState().itemsByList[7]).toHaveLength(1);
    });
  });

  describe('removeItem', () => {
    it('deletes the favorite and removes it from the cached list locally', async () => {
      useFavoritesStore.setState({
        itemsByList: {
          7: [
            { id: 1, code: '600000', market: 'A', name: '浦发银行' },
            { id: 2, code: '000001', market: 'A', name: '平安银行' },
          ],
        },
      });
      vi.mocked(favoritesApi.remove).mockResolvedValue(undefined as never);

      await useFavoritesStore.getState().removeItem(1, 7);

      expect(favoritesApi.remove).toHaveBeenCalledWith(1);
      expect(useFavoritesStore.getState().itemsByList[7]).toEqual([
        { id: 2, code: '000001', market: 'A', name: '平安银行' },
      ]);
    });
  });

  describe('reorder', () => {
    it('updates sortOrder for each id in order then refetches the list', async () => {
      vi.mocked(favoritesApi.update).mockResolvedValue({} as Stock);
      vi.mocked(favoritesApi.list).mockResolvedValue([]);

      await useFavoritesStore.getState().reorder(7, [3, 1, 2]);

      expect(favoritesApi.update).toHaveBeenCalledWith(3, { sortOrder: 0 });
      expect(favoritesApi.update).toHaveBeenCalledWith(1, { sortOrder: 1 });
      expect(favoritesApi.update).toHaveBeenCalledWith(2, { sortOrder: 2 });
      expect(favoritesApi.list).toHaveBeenCalledWith(7);
    });
  });

  describe('pin', () => {
    it('updates pinned status then refetches the list', async () => {
      vi.mocked(favoritesApi.update).mockResolvedValue({} as Stock);
      vi.mocked(favoritesApi.list).mockResolvedValue([
        { id: 1, code: '600000', market: 'A', name: '浦发银行', pinned: true },
      ]);

      await useFavoritesStore.getState().pin(1, 7, true);

      expect(favoritesApi.update).toHaveBeenCalledWith(1, { pinned: true });
      expect(favoritesApi.list).toHaveBeenCalledWith(7);
    });
  });
});
```

- [ ] 完成上述测试文件

### Step 8: 运行测试确认失败

Run: `cd frontend && pnpm exec vitest run favoritesStore.spec.ts`
Expected: FAIL — 旧 `favoritesStore` 没有 `fetchList`/`addToList`/`removeItem`/`reorder`/`pin` 方法

- [ ] 确认失败信息符合预期

### Step 9: 重写 `favoritesStore`

```ts
// frontend/src/store/favoritesStore.ts
import { create } from 'zustand';
import type { Stock } from '../types';
import { favoritesApi } from '../api/stock';

interface FavoritesStore {
  itemsByList: Record<number, Stock[]>;
  fetchList: (watchListId: number) => Promise<void>;
  addToList: (
    watchListId: number,
    stock: { code: string; market: 'A' | 'HK' | 'FUND'; name: string },
  ) => Promise<void>;
  removeItem: (favoriteId: number, watchListId: number) => Promise<void>;
  reorder: (watchListId: number, orderedIds: number[]) => Promise<void>;
  pin: (favoriteId: number, watchListId: number, pinned: boolean) => Promise<void>;
}

export const useFavoritesStore = create<FavoritesStore>((set, get) => ({
  itemsByList: {},

  fetchList: async (watchListId) => {
    const items = await favoritesApi.list(watchListId);
    set((s) => ({ itemsByList: { ...s.itemsByList, [watchListId]: items } }));
  },

  addToList: async (watchListId, stock) => {
    await favoritesApi.add({ ...stock, watchListId });
    await get().fetchList(watchListId);
  },

  removeItem: async (favoriteId, watchListId) => {
    await favoritesApi.remove(favoriteId);
    set((s) => ({
      itemsByList: {
        ...s.itemsByList,
        [watchListId]: (s.itemsByList[watchListId] ?? []).filter((f) => f.id !== favoriteId),
      },
    }));
  },

  reorder: async (watchListId, orderedIds) => {
    await Promise.all(orderedIds.map((id, index) => favoritesApi.update(id, { sortOrder: index })));
    await get().fetchList(watchListId);
  },

  pin: async (favoriteId, watchListId, pinned) => {
    await favoritesApi.update(favoriteId, { pinned });
    await get().fetchList(watchListId);
  },
}));
```

- [ ] 完成上述实现

### Step 10: 运行测试确认通过

Run: `cd frontend && pnpm exec vitest run favoritesStore.spec.ts watchListStore.spec.ts`
Expected: PASS（全部测试用例通过）

- [ ] 确认通过

### Step 11: Sidebar 列表切换 UI

```tsx
// frontend/src/components/Sidebar/index.tsx
import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Button, Tooltip, Space, Typography, Select, Modal, Input, Popconfirm } from 'antd';
import {
  DeleteOutlined,
  PushpinOutlined,
  PushpinFilled,
  ArrowUpOutlined,
  ArrowDownOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import { useFavoritesStore } from '../../store/favoritesStore';
import { useWatchListStore } from '../../store/watchListStore';
import StockSearch from '../StockSearch';
import FundSearch from '../FundSearch';
import type { Stock, BoardType } from '../../types';
import styles from './Sidebar.module.css';

const { Text } = Typography;

const SECTION_OPTIONS = [
  { value: 'stock', label: '股票' },
  { value: 'backtest', label: '策略回测' },
  { value: 'fund', label: '基金' },
  { value: 'list', label: '股票列表导入' },
];

export default function Sidebar() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { itemsByList, fetchList, removeItem, pin, reorder } = useFavoritesStore();
  const {
    stockLists,
    fundLists,
    currentStockListId,
    currentFundListId,
    fetchLists,
    createList,
    deleteList,
    setCurrentList,
  } = useWatchListStore();
  const [addListOpen, setAddListOpen] = useState(false);
  const [newListName, setNewListName] = useState('');

  const section = pathname.startsWith('/strategy-backtest')
    ? 'backtest'
    : pathname.startsWith('/fund')
      ? 'fund'
      : pathname.startsWith('/stock-list-import')
        ? 'list'
        : 'stock';

  const boardType: BoardType | null = section === 'list' ? null : section === 'fund' ? 'fund' : 'stock';
  const lists = boardType === 'fund' ? fundLists : stockLists;
  const currentListId = boardType === 'fund' ? currentFundListId : currentStockListId;
  const currentList = lists.find((l) => l.id === currentListId) ?? null;
  const items = currentListId != null ? itemsByList[currentListId] ?? [] : [];

  useEffect(() => {
    if (boardType) fetchLists(boardType);
  }, [boardType, fetchLists]);

  useEffect(() => {
    if (currentListId != null) fetchList(currentListId);
  }, [currentListId, fetchList]);

  const moveItem = (list: Stock[], index: number, direction: 'up' | 'down') => {
    if (currentListId == null) return;
    const copy = [...list];
    const target = direction === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= copy.length) return;
    [copy[index], copy[target]] = [copy[target], copy[index]];
    reorder(currentListId, copy.map((f) => f.id!));
  };

  const handleSectionChange = (val: string) => {
    if (val === 'backtest') {
      navigate('/strategy-backtest');
    } else if (val === 'stock') {
      navigate('/stock');
    } else if (val === 'fund') {
      navigate('/fund');
    } else {
      navigate('/stock-list-import');
    }
  };

  const handleCreateList = async () => {
    if (!boardType || !newListName.trim()) return;
    await createList(newListName.trim(), boardType);
    setAddListOpen(false);
    setNewListName('');
  };

  const renderItem = (stock: Stock, index: number, list: Stock[], urlFn: (s: Stock) => string) => (
    <div
      key={stock.id}
      className={`${styles.item} ${stock.pinned ? styles.pinnedItem : ''} ${
        pathname === urlFn(stock) ? styles.selected : ''
      }`}
      onClick={() => navigate(urlFn(stock))}
    >
      <div className={styles.stockInfo}>
        <div className={styles.nameRow}>
          {stock.pinned && <PushpinFilled className={styles.pinIcon} />}
          <Text strong className={styles.name}>{stock.name}</Text>
        </div>
        <Text type="secondary" className={styles.code}>
          {stock.code} · {stock.market === 'HK' ? '港股' : stock.market === 'FUND' ? '基金' : 'A股'}
        </Text>
      </div>
      <Space size={0} className={styles.actions} onClick={(e) => e.stopPropagation()}>
        <Tooltip title={stock.pinned ? '取消置顶' : '置顶'}>
          <Button
            type="text"
            size="small"
            icon={stock.pinned ? <PushpinFilled /> : <PushpinOutlined />}
            onClick={() => currentListId != null && pin(stock.id!, currentListId, !stock.pinned)}
          />
        </Tooltip>
        <Tooltip title="上移">
          <Button
            type="text"
            size="small"
            icon={<ArrowUpOutlined />}
            disabled={index === 0}
            onClick={() => moveItem(list, index, 'up')}
          />
        </Tooltip>
        <Tooltip title="下移">
          <Button
            type="text"
            size="small"
            icon={<ArrowDownOutlined />}
            disabled={index === list.length - 1}
            onClick={() => moveItem(list, index, 'down')}
          />
        </Tooltip>
        <Tooltip title="删除">
          <Button
            type="text"
            size="small"
            danger
            icon={<DeleteOutlined />}
            onClick={() => currentListId != null && removeItem(stock.id!, currentListId)}
          />
        </Tooltip>
      </Space>
    </div>
  );

  return (
    <div className={styles.sidebar}>
      <div className={styles.sectionSelect}>
        <Select
          value={section}
          options={SECTION_OPTIONS}
          onChange={(val) => handleSectionChange(val)}
          style={{ width: '100%' }}
        />
      </div>

      {boardType && (
        <div className={styles.listSwitcher}>
          <Select
            value={currentListId ?? undefined}
            options={lists.map((l) => ({ value: l.id, label: l.name }))}
            onChange={(id) => setCurrentList(boardType, id)}
            style={{ flex: 1 }}
            size="small"
          />
          <Tooltip title="新建列表">
            <Button
              type="text"
              size="small"
              icon={<PlusOutlined />}
              onClick={() => setAddListOpen(true)}
            />
          </Tooltip>
          {currentList && !currentList.isDefault && (
            <Popconfirm
              title={`确定删除列表「${currentList.name}」？`}
              description={`列表内的 ${items.length} 个标的也会被删除`}
              onConfirm={() => deleteList(currentList.id, boardType)}
              okText="删除"
              okButtonProps={{ danger: true }}
              cancelText="取消"
            >
              <Tooltip title="删除列表">
                <Button type="text" size="small" danger icon={<DeleteOutlined />} />
              </Tooltip>
            </Popconfirm>
          )}
        </div>
      )}

      {section !== 'list' && (
        <div className={styles.search}>
          {section === 'fund' ? (
            <FundSearch size="middle" />
          ) : (
            <StockSearch
              size="middle"
              onSelect={
                section === 'backtest'
                  ? (stock) => navigate(`/strategy-backtest/${stock.code}`)
                  : undefined
              }
            />
          )}
        </div>
      )}

      {(section === 'stock' || section === 'backtest') && (
        <div>
          {items.map((stock, index) =>
            renderItem(
              stock,
              index,
              items,
              section === 'backtest'
                ? (s) => `/strategy-backtest/${s.code}`
                : (s) => `/stock/${s.market}/${s.code}`,
            ),
          )}
        </div>
      )}

      {section === 'fund' && (
        <div>
          {items.map((stock, index) => renderItem(stock, index, items, (s) => `/fund/${s.code}`))}
        </div>
      )}

      <Modal
        title="新建列表"
        open={addListOpen}
        onCancel={() => {
          setAddListOpen(false);
          setNewListName('');
        }}
        onOk={handleCreateList}
        okButtonProps={{ disabled: !newListName.trim() }}
        okText="创建"
        cancelText="取消"
      >
        <Input
          placeholder="请输入列表名称"
          value={newListName}
          onChange={(e) => setNewListName(e.target.value)}
          onPressEnter={handleCreateList}
          autoFocus
        />
      </Modal>
    </div>
  );
}
```

- [ ] 完成上述修改（整文件替换）

注意：原代码 `stock`/`backtest` 两个 section 都来自同一份 `stockFavorites`（按 `market !== 'FUND'` 过滤），现在 `items` 已经是「当前选中的 stock 板块列表」内容，天然只含 A/HK 标的，因此渲染逻辑直接复用 `items`，不再需要按 market 过滤。

- [ ] **Step 12: Sidebar 样式**

```css
/* frontend/src/components/Sidebar/Sidebar.module.css */
/* 在 .sectionSelect 规则之后新增： */

.listSwitcher {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 12px;
  border-bottom: 1px solid #f0f0f0;
}
```

- [ ] 完成上述修改

### Step 13: `AddToListMenu` 组件

```tsx
// frontend/src/components/AddToListMenu/index.tsx
import { useEffect, useState } from 'react';
import { Dropdown, Button, Checkbox, Space, Empty } from 'antd';
import { DownOutlined } from '@ant-design/icons';
import { useWatchListStore } from '../../store/watchListStore';
import { useFavoritesStore } from '../../store/favoritesStore';
import type { BoardType } from '../../types';

interface Props {
  boardType: BoardType;
  stock: { code: string; market: 'A' | 'HK' | 'FUND'; name: string };
}

export default function AddToListMenu({ boardType, stock }: Props) {
  const { stockLists, fundLists, fetchLists } = useWatchListStore();
  const { itemsByList, fetchList, addToList, removeItem } = useFavoritesStore();
  const [open, setOpen] = useState(false);

  const lists = (boardType === 'stock' ? stockLists : fundLists).filter((l) => !l.isDefault);

  useEffect(() => {
    fetchLists(boardType);
  }, [boardType, fetchLists]);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      lists.forEach((l) => {
        if (!itemsByList[l.id]) fetchList(l.id);
      });
    }
  };

  const toggle = (listId: number, checked: boolean) => {
    if (checked) {
      addToList(listId, stock);
    } else {
      const existing = (itemsByList[listId] ?? []).find(
        (f) => f.code === stock.code && f.market === stock.market,
      );
      if (existing?.id != null) removeItem(existing.id, listId);
    }
  };

  return (
    <Dropdown
      open={open}
      onOpenChange={handleOpenChange}
      trigger={['click']}
      popupRender={() => (
        <div
          style={{
            background: '#fff',
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            borderRadius: 8,
            padding: 8,
            minWidth: 180,
          }}
        >
          {lists.length === 0 ? (
            <Empty
              description="暂无自定义列表，可在侧边栏「+」新建"
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              style={{ margin: 8 }}
            />
          ) : (
            <Space direction="vertical" size={4} style={{ width: '100%' }}>
              {lists.map((l) => {
                const checked = (itemsByList[l.id] ?? []).some(
                  (f) => f.code === stock.code && f.market === stock.market,
                );
                return (
                  <Checkbox key={l.id} checked={checked} onChange={(e) => toggle(l.id, e.target.checked)}>
                    {l.name}
                  </Checkbox>
                );
              })}
            </Space>
          )}
        </div>
      )}
    >
      <Button type="text" icon={<DownOutlined />}>
        加入列表
      </Button>
    </Dropdown>
  );
}
```

- [ ] 完成上述新建

### Step 14: 接入 `StockDetail`

```tsx
// frontend/src/pages/StockDetail/index.tsx
// 修改 import 区块：
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Typography, Descriptions, Spin, Tag, Button, Tooltip } from 'antd';
import { StarOutlined, StarFilled, LineChartOutlined } from '@ant-design/icons';
import { stocksApi } from '../../api/stock';
import KLineChart from '../../components/KLineChart';
import StockMonitorButton from '../../components/StockMonitorButton';
import AddToListMenu from '../../components/AddToListMenu';
import { useFavoritesStore } from '../../store/favoritesStore';
import { useWatchListStore } from '../../store/watchListStore';
import type { StockInfo } from '../../types';
import styles from './StockDetail.module.css';

// 替换原 `const { favorites, addStock, removeStock } = useFavoritesStore();` 之后的两行：
export default function StockDetail() {
  const { market, code } = useParams<{ market: string; code: string }>();
  const navigate = useNavigate();
  const [info, setInfo] = useState<StockInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const { itemsByList, fetchList, addToList, removeItem } = useFavoritesStore();
  const { stockLists, fetchLists } = useWatchListStore();
  const defaultListId = stockLists.find((l) => l.isDefault)?.id ?? null;
  const favoriteEntry =
    defaultListId != null
      ? (itemsByList[defaultListId] ?? []).find((f) => f.market === market && f.code === code)
      : undefined;
  const isFavorited = !!favoriteEntry;

  useEffect(() => {
    fetchLists('stock');
  }, [fetchLists]);

  useEffect(() => {
    if (defaultListId != null) fetchList(defaultListId);
  }, [defaultListId, fetchList]);

  useEffect(() => {
    if (!market || !code) return;
    setInfo(null);
    setLoading(true);
    stocksApi
      .getInfo(market as 'A' | 'HK', code)
      .then(setInfo)
      .catch(() => setInfo(null))
      .finally(() => setLoading(false));
  }, [market, code]);
```

```tsx
// 在同文件，替换 ☆ 按钮的 onClick 与其后续 JSX（紧跟在 ☆ Tooltip 之后插入 AddToListMenu）：
        {market && code && (
          <Tooltip title={isFavorited ? '取消收藏' : '添加收藏'}>
            <Button
              type="text"
              icon={isFavorited ? <StarFilled style={{ color: '#faad14' }} /> : <StarOutlined />}
              onClick={() => {
                if (isFavorited) {
                  removeItem(favoriteEntry!.id!, defaultListId!);
                } else if (defaultListId != null) {
                  addToList(defaultListId, { code, market: market as 'A' | 'HK', name: info?.name ?? code });
                }
              }}
            />
          </Tooltip>
        )}
        {market && code && (
          <AddToListMenu
            boardType="stock"
            stock={{ code, market: market as 'A' | 'HK', name: info?.name ?? code }}
          />
        )}
        {market && code && (
          <>
            <Tooltip title="策略回测">
              <Button
                type="text"
                icon={<LineChartOutlined />}
                onClick={() => navigate(`/strategy-backtest/${code}`)}
              />
            </Tooltip>
            <StockMonitorButton
              market={market as 'A' | 'HK'}
              code={code}
              stockName={info?.name ?? code ?? ''}
            />
```

- [ ] 完成上述修改（保持文件其余部分不变）

### Step 15: 接入 `FundDetail`

```tsx
// frontend/src/pages/FundDetail/index.tsx
// 修改 import 区块：
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Typography, Descriptions, Spin, Tag, Button, Tooltip } from 'antd';
import { StarOutlined, StarFilled } from '@ant-design/icons';
import { fundApi } from '../../api/stock';
import NavChart from '../../components/NavChart';
import HoldingKlinePopup from '../../components/HoldingKlinePopup';
import AddToListMenu from '../../components/AddToListMenu';
import { useFavoritesStore } from '../../store/favoritesStore';
import { useWatchListStore } from '../../store/watchListStore';
import type { FundInfo, FundHoldingPeriod } from '../../types';
import styles from './FundDetail.module.css';

// 替换 `const { favorites, addStock, removeStock } = useFavoritesStore();` 等两行：
  const { itemsByList, fetchList, addToList, removeItem } = useFavoritesStore();
  const { fundLists, fetchLists } = useWatchListStore();
  const defaultListId = fundLists.find((l) => l.isDefault)?.id ?? null;
  const favoriteEntry =
    defaultListId != null
      ? (itemsByList[defaultListId] ?? []).find((f) => f.market === 'FUND' && f.code === code)
      : undefined;
  const isFavorited = !!favoriteEntry;

  useEffect(() => {
    fetchLists('fund');
  }, [fetchLists]);

  useEffect(() => {
    if (defaultListId != null) fetchList(defaultListId);
  }, [defaultListId, fetchList]);
```

```tsx
// 替换 ☆ 按钮区块（紧跟其后插入 AddToListMenu）：
        {code && (
          <Tooltip title={isFavorited ? '取消收藏' : '添加收藏'}>
            <Button
              type="text"
              icon={isFavorited ? <StarFilled style={{ color: '#faad14' }} /> : <StarOutlined />}
              onClick={() => {
                if (isFavorited) {
                  removeItem(favoriteEntry!.id!, defaultListId!);
                } else if (defaultListId != null) {
                  addToList(defaultListId, { code, market: 'FUND', name: info?.name ?? code });
                }
              }}
            />
          </Tooltip>
        )}
        {code && <AddToListMenu boardType="fund" stock={{ code, market: 'FUND', name: info?.name ?? code }} />}
```

- [ ] 完成上述修改（保持文件其余部分不变，注意 `useEffect` 的 import 已在原文件第一行）

### Step 16: 接入 `StrategyBacktest`

```tsx
// frontend/src/pages/StrategyBacktest/index.tsx
// 顶部 import 增加：
import AddToListMenu from '../../components/AddToListMenu';
import { useWatchListStore } from '../../store/watchListStore';

// 替换：
//   const { favorites, addStock, removeStock } = useFavoritesStore();
//   const favoriteEntry = favorites.find((f) => f.market === market && f.code === code);
//   const isFavorited = !!favoriteEntry;
//
//   const toggleFavorite = () => {
//     if (!code) return;
//     if (isFavorited) {
//       void removeStock(favoriteEntry!.id!);
//     } else {
//       void addStock({ code, market, name: stockName ?? favoriteEntry?.name ?? code });
//     }
//   };
// 为：
  const { itemsByList, fetchList, addToList, removeItem } = useFavoritesStore();
  const { stockLists, fetchLists } = useWatchListStore();
  const defaultListId = stockLists.find((l) => l.isDefault)?.id ?? null;
  const favoriteEntry =
    defaultListId != null
      ? (itemsByList[defaultListId] ?? []).find((f) => f.market === market && f.code === code)
      : undefined;
  const isFavorited = !!favoriteEntry;

  useEffect(() => {
    fetchLists('stock');
  }, [fetchLists]);

  useEffect(() => {
    if (defaultListId != null) fetchList(defaultListId);
  }, [defaultListId, fetchList]);

  const toggleFavorite = () => {
    if (!code || defaultListId == null) return;
    if (isFavorited) {
      void removeItem(favoriteEntry!.id!, defaultListId);
    } else {
      void addToList(defaultListId, { code, market, name: stockName ?? favoriteEntry?.name ?? code });
    }
  };
```

```tsx
// 在 Card title 区块内，紧跟 ☆ 按钮的 Tooltip 之后插入：
            <Tooltip title={isFavorited ? '取消收藏' : '添加收藏'}>
              <Button
                type="text"
                size="small"
                icon={isFavorited ? <StarFilled style={{ color: '#faad14' }} /> : <StarOutlined />}
                onClick={toggleFavorite}
              />
            </Tooltip>
            {code && <AddToListMenu boardType="stock" stock={{ code, market, name: stockName ?? code }} />}
```

- [ ] 完成上述修改（保持文件其余部分不变，`useEffect` 已在原文件顶部 import）

### Step 17: 接入 `StockListImport`

```tsx
// frontend/src/pages/StockListImport/index.tsx
// 顶部 import 增加：
import { useEffect } from 'react';
import { useWatchListStore } from '../../store/watchListStore';

// 替换：
//   const { favorites, addStock } = useFavoritesStore();
//
//   const hoveredIsFavorited = hovered
//     ? favorites.some((f) => f.code === hovered.code && f.market === hovered.market)
//     : false;
// 为：
  const { itemsByList, fetchList, addToList } = useFavoritesStore();
  const { stockLists, fetchLists } = useWatchListStore();
  const defaultListId = stockLists.find((l) => l.isDefault)?.id ?? null;

  useEffect(() => {
    fetchLists('stock');
  }, [fetchLists]);

  useEffect(() => {
    if (defaultListId != null) fetchList(defaultListId);
  }, [defaultListId, fetchList]);

  const hoveredIsFavorited =
    hovered && defaultListId != null
      ? (itemsByList[defaultListId] ?? []).some(
          (f) => f.code === hovered.code && f.market === hovered.market,
        )
      : false;

// 替换：
//   const handleAddFavorite = () => {
//     if (!hovered) return;
//     addStock({ code: hovered.code, market: hovered.market, name: hovered.name });
//   };
// 为：
  const handleAddFavorite = () => {
    if (!hovered || defaultListId == null) return;
    addToList(defaultListId, { code: hovered.code, market: hovered.market, name: hovered.name });
  };
```

- [ ] 完成上述修改（保持文件其余部分不变；注意原文件第一行已是 `import { useState, useRef } from 'react';`，需改为 `import { useEffect, useState, useRef } from 'react';`）

### Step 18: 全量校验

Run: `cd frontend && pnpm exec vitest run && pnpm exec tsc -b && pnpm exec eslint .`
Expected: 全部测试通过；`tsc -b` 无错误；`eslint` 无错误

- [ ] 确认全部通过

- [ ] **Step 19: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/api/stock.ts frontend/src/store/watchListStore.ts frontend/src/store/watchListStore.spec.ts frontend/src/store/favoritesStore.ts frontend/src/store/favoritesStore.spec.ts frontend/src/components/Sidebar/index.tsx frontend/src/components/Sidebar/Sidebar.module.css frontend/src/components/AddToListMenu/index.tsx frontend/src/pages/StockDetail/index.tsx frontend/src/pages/FundDetail/index.tsx frontend/src/pages/StrategyBacktest/index.tsx frontend/src/pages/StockListImport/index.tsx
git commit -m "feat: 前端接入多标的列表，侧边栏支持新建/切换/删除列表"
```

---

## Task 4: 手动验证（开发环境走查）

**Files:** 无代码改动

- [ ] **Step 1: 启动后端与前端开发服务**

```bash
cd backend && pnpm start:dev
```

```bash
cd frontend && pnpm dev
```

- [ ] **Step 2: 验证默认列表自举与迁移**

打开浏览器访问 `http://localhost:5173/stock`，确认侧边栏出现「收藏夹」下拉项；若此前已有收藏数据，确认这些标的仍出现在「收藏夹」中（A股/港股归入股票板块收藏夹，基金归入基金板块收藏夹）。

- [ ] **Step 3: 验证新建列表**

点击下拉框右侧「+」，输入「我的自选股」并创建，确认下拉框自动切换到新列表且内容为空。

- [ ] **Step 4: 验证「加入列表」**

进入任意股票详情页，点击「加入列表」下拉，勾选「我的自选股」，回到侧边栏切换至该列表，确认标的已出现；取消勾选后确认标的从该列表移除，同时 ☆ 收藏夹状态不受影响。

- [ ] **Step 5: 验证删除列表**

切换到「我的自选股」，点击 🗑，确认弹出二次确认且提示标的数量；确认后列表被删除，侧边栏自动回退到「收藏夹」；确认「收藏夹」本身没有 🗑 按钮（不可删除）。

- [ ] **Step 6: 验证策略回测板块共享股票列表**

在「股票」板块新建/选择一个自定义列表后切换到「策略回测」板块，确认下拉框显示同一个当前选中列表及其内容（验证共享逻辑）。

- [ ] **Step 7: 验证基金板块独立**

切换到「基金」板块，确认列表下拉框与股票板块完全独立（互不影响）。

- [ ] **Step 8: 截图或记录验证结果，告知用户走查通过**

无需 commit（本任务不修改代码）。

---

## Self-Review Notes

- **Spec 覆盖检查**：数据模型与迁移（Task 1）、API 变更（Task 1/2）、`watchListStore`/`favoritesStore`（Task 3 Step 1-10）、Sidebar UI（Task 3 Step 11-12）、详情页加入列表入口（Task 3 Step 13-17）、StockListImport 维持收藏夹语义（Task 3 Step 17）、手动验证（Task 4）均有对应任务覆盖。
- **占位符检查**：已确认所有步骤均为完整代码，无 TODO/TBD。
- **类型一致性检查**：`WatchList`/`BoardType` 类型、`watchListsApi`/`favoritesApi` 方法签名、`useWatchListStore`/`useFavoritesStore` 的方法名与参数顺序在 Task 3 全文中保持一致（`fetchList(watchListId)`、`addToList(watchListId, stock)`、`removeItem(favoriteId, watchListId)`、`pin(favoriteId, watchListId, pinned)`、`reorder(watchListId, orderedIds)`）。
