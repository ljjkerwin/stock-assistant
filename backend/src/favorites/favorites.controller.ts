import { Controller, Get, Post, Delete, Patch, Param, Body, ParseIntPipe } from '@nestjs/common';
import { FavoritesService } from './favorites.service';

@Controller('api/favorites')
export class FavoritesController {
  constructor(private readonly service: FavoritesService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Post()
  add(@Body() body: { code: string; market: string; name: string }) {
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
