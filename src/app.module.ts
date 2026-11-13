import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { TjModule } from './tj/tj.module';
import { GeoModule } from './geo/geo.module';
import { OltModule } from './olt/olt.module';
import { OnuModule } from './onu/onu.module';

@Module({
  imports: [DatabaseModule, AuthModule, OltModule, OnuModule, TjModule, GeoModule],
  controllers: [AppController],
})
export class AppModule {}
