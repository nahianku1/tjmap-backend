import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { TjModule } from './tj/tj.module';
import { GeoModule } from './geo/geo.module';

@Module({
  imports: [DatabaseModule, AuthModule, TjModule, GeoModule],
  controllers: [AppController],
})
export class AppModule {}
