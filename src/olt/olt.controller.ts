import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { OltService } from './olt.service';
import { CreateOltDto, UpdateOltDto } from './olt.dto';
import { AuthenticatedRequest, JwtAuthGuard, RolesGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('olts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OltController {
  constructor(private readonly olts: OltService) {}

  @Get()
  list(@Query('areaId') areaId?: string) {
    return this.olts.list(areaId);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.olts.get(id);
  }

  @Post()
  @Roles('admin')
  create(@Body() dto: CreateOltDto, @Req() req: AuthenticatedRequest) {
    return this.olts.create(dto, req.user!.id);
  }

  @Patch(':id')
  @Roles('admin')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateOltDto) {
    return this.olts.update(id, dto);
  }

  @Delete(':id')
  @Roles('admin')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.olts.remove(id);
  }
}
