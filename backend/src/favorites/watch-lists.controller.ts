import { Controller, Get, Post, Delete, Param, Body, Query, ParseIntPipe } from '@nestjs/common';
import { WatchListsService } from './watch-lists.service';
import type { BoardType } from './watch-lists.service';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/current-user.decorator';

@Controller('api/watchlists')
export class WatchListsController {
  constructor(private readonly service: WatchListsService) {}

  @Get()
  findAll(@CurrentUser() user: AuthUser, @Query('boardType') boardType: BoardType) {
    return this.service.findAll(user.id, boardType);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: { name: string; boardType: BoardType }) {
    return this.service.create({ userId: user.id, name: body.name, boardType: body.boardType });
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id, user.id);
  }
}
