import { Controller, Get } from '@nestjs/common';
import { DatabaseService } from './database/database.service';

@Controller()
export class AppController {
  constructor(private readonly db: DatabaseService) {}

  @Get('health')
  async health() {
    const rows = await this.db.query<{ postgis: string | null }>(
      'SELECT postgis_lib_version() AS postgis',
    );
    return {
      status: 'ok',
      service: 'isp-tj-api',
      postgis: rows[0]?.postgis ?? null,
      time: new Date().toISOString(),
    };
  }
}
