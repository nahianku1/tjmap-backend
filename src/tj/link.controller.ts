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
import { LinkService } from './link.service';
import { CreateLinkDto, UpdateLinkDto } from './tj.dto';
import { AuthenticatedRequest, JwtAuthGuard, RolesGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('links')
@UseGuards(JwtAuthGuard, RolesGuard)
export class LinkController {
  constructor(private readonly links: LinkService) {}

  @Get()
  list() {
    return this.links.list();
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.links.get(id);
  }

  @Post()
  @Roles('admin')
  create(@Body() dto: CreateLinkDto, @Req() req: AuthenticatedRequest) {
    return this.links.create(dto, req.user!.id);
  }

  @Patch(':id')
  @Roles('admin')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateLinkDto) {
    return this.links.update(id, dto);
  }

  @Delete(':id')
  @Roles('admin')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.links.remove(id);
  }
}
