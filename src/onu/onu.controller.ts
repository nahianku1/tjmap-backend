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
import { OnuService } from './onu.service';
import { CreateOnuDto, UpdateOnuDto } from './onu.dto';
import { AuthenticatedRequest, JwtAuthGuard, RolesGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('onus')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OnuController {
  constructor(private readonly onus: OnuService) {}

  @Get()
  list(@Query('areaId') areaId?: string) {
    return this.onus.list(areaId);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.onus.get(id);
  }

  @Post()
  @Roles('admin')
  create(@Body() dto: CreateOnuDto, @Req() req: AuthenticatedRequest) {
    return this.onus.create(dto, req.user!.id);
  }

  @Patch(':id')
  @Roles('admin')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateOnuDto) {
    return this.onus.update(id, dto);
  }

  @Delete(':id')
  @Roles('admin')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.onus.remove(id);
  }
}
