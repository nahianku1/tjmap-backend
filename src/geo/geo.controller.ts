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
import { GeoService } from './geo.service';
import {
  CreateAreaDto,
  CreateDistrictDto,
  CreateSubAreaDto,
  UpdateAreaDto,
  UpdateDistrictDto,
  UpdateSubAreaDto,
} from './geo.dto';
import { AuthenticatedRequest, JwtAuthGuard, RolesGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class GeoController {
  constructor(private readonly geo: GeoService) {}

  @Get('districts')
  listDistricts() {
    return this.geo.listDistricts();
  }

  @Post('districts')
  @Roles('admin')
  createDistrict(@Body() dto: CreateDistrictDto, @Req() req: AuthenticatedRequest) {
    return this.geo.createDistrict(dto, req.user!.id);
  }

  @Get('districts/:id')
  getDistrict(@Param('id', ParseUUIDPipe) id: string) {
    return this.geo.getDistrict(id);
  }

  @Patch('districts/:id')
  @Roles('admin')
  updateDistrict(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDistrictDto) {
    return this.geo.updateDistrict(id, dto);
  }

  @Delete('districts/:id')
  @Roles('admin')
  removeDistrict(@Param('id', ParseUUIDPipe) id: string) {
    return this.geo.removeDistrict(id);
  }

  @Post('districts/:id/areas')
  @Roles('admin')
  createArea(
    @Param('id', ParseUUIDPipe) districtId: string,
    @Body() dto: CreateAreaDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.geo.createArea(districtId, dto, req.user!.id);
  }

  @Get('areas')
  listAreas(@Query('districtId') districtId?: string) {
    return this.geo.listAreas(districtId);
  }

  @Get('areas/:id')
  getArea(@Param('id', ParseUUIDPipe) id: string) {
    return this.geo.getArea(id);
  }

  @Get('areas/:id/network')
  network(@Param('id', ParseUUIDPipe) id: string) {
    return this.geo.network(id);
  }

  @Patch('areas/:id')
  @Roles('admin')
  updateArea(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAreaDto) {
    return this.geo.updateArea(id, dto);
  }

  @Delete('areas/:id')
  @Roles('admin')
  removeArea(@Param('id', ParseUUIDPipe) id: string) {
    return this.geo.removeArea(id);
  }

  @Delete('areas/:id/sub-areas')
  @Roles('admin')
  removeSubAreas(@Param('id', ParseUUIDPipe) id: string) {
    return this.geo.removeSubAreas(id);
  }

  @Get('sub-areas')
  listSubAreas(@Query('areaId') areaId?: string) {
    return this.geo.listSubAreas(areaId);
  }

  @Get('sub-areas/:id')
  getSubArea(@Param('id', ParseUUIDPipe) id: string) {
    return this.geo.getSubArea(id);
  }

  @Post('areas/:id/sub-areas')
  @Roles('admin')
  createSubArea(
    @Param('id', ParseUUIDPipe) areaId: string,
    @Body() dto: CreateSubAreaDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.geo.createSubArea(areaId, dto, req.user!.id);
  }

  @Patch('sub-areas/:id')
  @Roles('admin')
  updateSubArea(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSubAreaDto) {
    return this.geo.updateSubArea(id, dto);
  }

  @Delete('sub-areas/:id')
  @Roles('admin')
  removeSubArea(@Param('id', ParseUUIDPipe) id: string) {
    return this.geo.removeSubArea(id);
  }
}
