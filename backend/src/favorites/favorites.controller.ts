import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Param,
  Body,
  Query,
  ParseIntPipe,
} from '@nestjs/common';
import { FavoritesService } from './favorites.service';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/current-user.decorator';

@Controller('api/favorites')
export class FavoritesController {
  constructor(private readonly service: FavoritesService) {}

  @Get()
  findAll(@CurrentUser() user: AuthUser, @Query('watchListId', ParseIntPipe) watchListId: number) {
    return this.service.findAll(watchListId, user.id);
  }

  @Post()
  add(
    @CurrentUser() user: AuthUser,
    @Body() body: { code: string; market: string; name: string; watchListId: number },
  ) {
    return this.service.add(body, user.id);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id, user.id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { sortOrder?: number; pinned?: boolean },
  ) {
    return this.service.update(id, user.id, body);
  }
}
