# 标的列表（多收藏夹）设计

## 背景与目标

当前收藏功能是单一全局列表（`favorites` 表），按 `market` 字段在前端拆分展示为「股票收藏」「基金收藏」两个视图。本次需求：支持用户在「收藏夹」之外维护多个自定义标的列表（例如「我的自选股」「打新观察」等），并通过侧边栏的下拉框 + 「+」号入口切换/新建列表。

## 范围与关键决策

- **列表按板块独立**：股票板块（含「股票」「策略回测」两个 section，共享同一套列表）和基金板块（「基金」 section）各自维护独立的列表集合，互不影响。
- **「收藏夹」作为特殊保留列表**：每个板块各有一个不可删除/不可重命名的「收藏夹」（`isDefault=true`），是该板块的默认列表，永远存在。
- **详情页 ☆ 收藏按钮语义不变**：始终只读写对应板块的「收藏夹」。
- **加入自定义列表的入口**：详情页（股票详情 / 基金详情 / 策略回测）在 ☆ 按钮旁新增「加入列表」下拉菜单，勾选/取消即可将当前标的加入或移出指定自定义列表。
- **支持删除自定义列表**（收藏夹不可删），删除时级联删除该列表下的所有标的，需二次确认。
- **不支持本次**：列表重命名、列表排序、详情页菜单内创建新列表（创建仅在侧边栏「+」入口）、`StockListImport` 页面接入自定义列表（仍只操作收藏夹）。

## 数据模型（后端）

### 新增实体 `WatchList`（`backend/src/favorites/watch-list.entity.ts`）

```
id: number (PK)
name: string
boardType: 'stock' | 'fund'
isDefault: boolean (default false)
createdAt: Date
```

### `Favorite` 实体新增字段

```
watchListId: number   // 普通列，无 TypeORM 关系（与现有 MonitorMessage.ruleId 风格一致）
```

### 启动自举与数据迁移（`WatchListsService.onModuleInit`）

项目使用 `synchronize: true`，无正式 migration 机制。启动时：

1. 若不存在 `boardType='stock', isDefault=true` 的列表，创建一条，name 为「收藏夹」；`boardType='fund'` 同理。
2. 将 `Favorite` 表中 `watchListId` 为空的行按 `market` 回填：`market === 'FUND'` → fund 收藏夹 id，其余 → stock 收藏夹 id。

此举确保已有用户数据无缝迁移，新装环境也始终有两个默认列表可用。

## 后端 API 变更

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/watchlists?boardType=stock\|fund` | 获取该板块的列表，`isDefault` 列表排最前，其余按 `createdAt` 升序 |
| POST | `/api/watchlists` | body `{ name, boardType }`，新建自定义列表 |
| DELETE | `/api/watchlists/:id` | 删除列表；目标列表 `isDefault=true` 时返回 400；级联删除该列表下所有 `Favorite` 行 |
| GET | `/api/favorites?watchListId=` | 原 `GET /api/favorites` 改为必填 `watchListId` 查询参数，仅返回该列表内的标的 |
| POST | `/api/favorites` | body 新增必填 `watchListId`；新增校验：根据 `watchListId` 查出列表的 `boardType`，与 `market`（`FUND` ⇔ `fund`，`A`/`HK` ⇔ `stock`）不匹配时返回 400 |
| DELETE | `/api/favorites/:id` | 不变 |
| PATCH | `/api/favorites/:id` | 不变（`sortOrder`/`pinned` 始终是列表内排序，天然按 `watchListId` 隔离） |

`FavoritesService.add` 的 `sortOrder` 计数需按 `watchListId` 过滤（而非全表计数）。

## 前端设计

### 类型新增（`frontend/src/types/index.ts`）

```ts
interface WatchList {
  id: number;
  name: string;
  boardType: 'stock' | 'fund';
  isDefault: boolean;
}
```

### API 封装（`frontend/src/api/stock.ts`）

```ts
watchListsApi = {
  list: (boardType: 'stock' | 'fund') => ...,
  create: (name: string, boardType: 'stock' | 'fund') => ...,
  remove: (id: number) => ...,
}
```

`favoritesApi.list` 增加 `watchListId` 参数；`favoritesApi.add` 的 body 增加 `watchListId`。

### 新增 `watchListStore`（Zustand）

```
stockLists: WatchList[]
fundLists: WatchList[]
currentStockListId: number | null
currentFundListId: number | null

fetchLists(boardType): Promise<void>
createList(name, boardType): Promise<WatchList>   // 创建后自动 setCurrentList 到新列表
deleteList(id, boardType): Promise<void>           // 删除后若被删的是当前选中列表，回退到该板块默认列表
setCurrentList(boardType, id): void
```

### `favoritesStore` 改造为按列表缓存

```
itemsByList: Record<number, Stock[]>

fetchList(watchListId): Promise<void>                       // GET，写入 itemsByList[watchListId]
addToList(watchListId, stock): Promise<void>                 // POST 后重新 fetchList
removeItem(favoriteId, watchListId): Promise<void>            // DELETE 后从 itemsByList[watchListId] 本地移除
reorder(watchListId, orderedIds): Promise<void>
pin(favoriteId, watchListId, pinned): Promise<void>
```

旧的 `favorites: Stock[]` 单一数组、`fetchFavorites`/`addStock`/`removeStock`/`reorderStocks`/`pinStock` 全部替换为上述按列表维度的方法；调用方需改为显式传入 `watchListId`。

### Sidebar 组件改造

- `section !== 'list'` 时，搜索框上方新增一行：
  - Ant Design `Select`：展示当前板块（stock 或 fund，`backtest` 视为 stock）的 `stockLists`/`fundLists`，值为 `currentStockListId`/`currentFundListId`
  - 紧邻的「+」`Button`：点击弹出 `Modal`（含一个 `Input`）输入列表名称，确认后调用 `createList`
  - 当前选中列表 `isDefault === false` 时，额外展示 🗑 `Button`：点击 `Popconfirm`「确定删除列表「X」？列表内的 N 个标的也会被删除」，确认后调用 `deleteList`
- 列表内容区（原 `stockFavorites`/`fundFavorites` 渲染逻辑）改为读取 `favoritesStore.itemsByList[currentListId]`，`useEffect` 在 `currentListId` 变化时调用 `fetchList`
- `stock` 与 `backtest` 两个 section 共用同一个 `currentStockListId` 及其内容（与现状「两个入口共享同一份收藏」的行为一致）

### 详情页改造（StockDetail / FundDetail / StrategyBacktest）

- 挂载时 `fetchLists('stock' | 'fund')` 确保 `watchListStore` 有数据，并 `fetchList(defaultListId)` 加载收藏夹内容
- ☆ 按钮：`isFavorited` 改为判断 `itemsByList[defaultListId]` 中是否存在该 `code+market`；点击调用 `addToList`/`removeItem`，目标列表固定为 `defaultListId`，行为与现状一致
- ☆ 按钮右侧新增「加入列表」`Dropdown`（菜单项为 `Checkbox` 列表）：
  - 菜单项 = 该板块除默认列表外的所有自定义列表（`stockLists`/`fundLists` 过滤 `isDefault === false`）
  - 下拉打开时，对尚未加载过的自定义列表懒调用 `fetchList(list.id)`
  - 勾选状态 = 当前标的是否存在于 `itemsByList[list.id]`
  - 勾选 → `addToList(list.id, stock)`；取消勾选 → 找到 `itemsByList[list.id]` 中匹配项的 `id`，调用 `removeItem`
  - 若该板块没有任何自定义列表，菜单显示「暂无自定义列表，可在侧边栏「+」新建」提示文案，不报错

### StockListImport 页面

不接入自定义列表，悬浮「添加」按钮维持现状，固定操作 stock 板块默认列表（收藏夹）。

## 错误处理与边界情况

- 删除列表时该列表恰好是侧边栏当前选中列表 → 前端删除成功后自动切回该板块默认列表并重新拉取内容
- 新建列表名称为空 → 前端 `Modal` 内禁用确认按钮（trim 后非空校验），不依赖后端校验
- `POST /api/favorites` 的 `market`/`boardType` 不匹配校验仅作为后端兜底防御（正常前端交互不会触发，因为各入口的 `watchListId` 来源本身已按板块过滤）
- 新装环境（无任何历史数据）启动后 `GET /api/watchlists?boardType=stock` 应至少返回一条「收藏夹」记录

## 测试要点

- 后端：`WatchListsService` 自举/迁移逻辑（已有数据迁移 + 全新环境建表）；`isDefault` 列表禁止删除；`FavoritesService.add` 的 `market`/`boardType` 校验；`sortOrder` 按 `watchListId` 隔离计数
- 前端：Sidebar 切换列表后内容区正确刷新；新建/删除列表后下拉框状态与选中项联动；详情页「加入列表」勾选状态与实际数据一致
