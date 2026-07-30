import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './user.entity';
import { PluginAccessToken } from './plugin-access-token.entity';
import { PluginTokenService } from './plugin-token.service';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { FavoritesModule } from '../favorites/favorites.module';

@Module({
  imports: [TypeOrmModule.forFeature([User, PluginAccessToken]), FavoritesModule],
  providers: [AuthService, PluginTokenService, { provide: APP_GUARD, useClass: AuthGuard }],
  controllers: [AuthController],
  exports: [AuthService, PluginTokenService],
})
export class AuthModule {}
