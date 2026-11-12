import { Module } from '@nestjs/common';
import { GeoController } from './geo.controller';
import { GeoService } from './geo.service';
import { TjModule } from '../tj/tj.module';

@Module({
  imports: [TjModule],
  controllers: [GeoController],
  providers: [GeoService],
})
export class GeoModule {}
