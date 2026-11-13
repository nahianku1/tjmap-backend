import { Module } from '@nestjs/common';
import { TjController } from './tj.controller';
import { TjService } from './tj.service';
import { LinkController } from './link.controller';
import { LinkService } from './link.service';
import { OltModule } from '../olt/olt.module';
import { OnuModule } from '../onu/onu.module';

@Module({
  imports: [OltModule, OnuModule],
  controllers: [TjController, LinkController],
  providers: [TjService, LinkService],
  exports: [TjService],
})
export class TjModule {}
