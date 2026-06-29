import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './user.entity';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { FavoritesModule } from '../favorites/favorites.module';

@Module({
  imports: [TypeOrmModule.forFeature([User]), FavoritesModule],
  providers: [AuthService, { provide: APP_GUARD, useClass: AuthGuard }],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}
