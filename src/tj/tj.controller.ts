import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { TjService } from './tj.service';
import { CreateTjDto, UpdateTjDto } from './tj.dto';
import { AuthenticatedRequest, JwtAuthGuard, RolesGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('tjs')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TjController {
  constructor(private readonly tjs: TjService) {}

  @Get('network')
  network() {
    return this.tjs.network();
  }

  @Get()
  list() {
    return this.tjs.list();
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.tjs.get(id);
  }

  @Post()
  @Roles('admin')
  create(@Body() dto: CreateTjDto, @Req() req: AuthenticatedRequest) {
    return this.tjs.create(dto, req.user!.id);
  }

  @Patch(':id')
  @Roles('admin')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTjDto) {
    return this.tjs.update(id, dto);
  }

  @Delete(':id')
  @Roles('admin')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.tjs.remove(id);
  }
}
