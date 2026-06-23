import { Controller, Get, Post, Delete, Param, Body, Query, ParseIntPipe } from '@nestjs/common';
import { WatchListsService } from './watch-lists.service';
import type { BoardType } from './watch-lists.service';

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
