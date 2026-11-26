import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import {
  ChangePasswordDto,
  CreateUserDto,
  LoginDto,
  RefreshDto,
  ResetPasswordDto,
  UpdateProfileDto,
  UpdateUserDto,
} from './auth.dto';
import { AuthenticatedRequest, JwtAuthGuard, RolesGuard } from './auth.guard';
import { Roles } from './roles.decorator';
import { config } from '../config';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  async updateMe(@Req() req: AuthenticatedRequest, @Body() dto: UpdateProfileDto) {
    return this.auth.updateProfile(req.user!.id, dto);
  }

  @Post('me/password')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  async changePassword(@Req() req: AuthenticatedRequest, @Body() dto: ChangePasswordDto) {
    await this.auth.changePassword(req.user!.id, dto);
    return { ok: true };
  }

  @Get('users')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async listUsers() {
    return this.auth.listUsers();
  }

  @Post('users')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async createUser(@Body() dto: CreateUserDto) {
    return this.auth.createUser(dto);
  }

  @Patch('users/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async updateUser(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.auth.updateUser(req.user!.id, id, dto);
  }

  @Delete('users/:id')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async deleteUser(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    await this.auth.deleteUser(req.user!.id, id);
    return { ok: true };
  }

  @Post('users/:id/password')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async resetUserPassword(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResetPasswordDto,
  ) {
    await this.auth.resetUserPassword(req.user!.id, id, dto);
    return { ok: true };
  }

  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const session = await this.auth.login(dto);
    this.setSessionCookies(res, session);
    return { accessToken: session.accessToken, expiresIn: session.accessExpiresIn, user: session.user };
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: Request,
    @Body() dto: RefreshDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = req.cookies?.[config.refreshCookieName] ?? dto?.refreshToken;
    if (!token) {
      throw new UnauthorizedException('No active session');
    }
    const session = await this.auth.rotateRefreshToken(token);
    this.setSessionCookies(res, session);
    return { accessToken: session.accessToken, expiresIn: session.accessExpiresIn, user: session.user };
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.cookies?.[config.refreshCookieName]);
    res.clearCookie(config.refreshCookieName, this.cookieOptions());
    res.clearCookie(config.accessCookieName, this.cookieOptions());
    return { ok: true };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@Req() req: AuthenticatedRequest) {
    return this.auth.me(req.user!.id);
  }

  /** Both tokens live in httpOnly cookies: the access one expires with its JWT, the
   *  refresh one lives for the session. */
  private setSessionCookies(
    res: Response,
    session: { accessToken: string; refreshToken: string; accessExpiresIn: number },
  ): void {
    res.cookie(config.accessCookieName, session.accessToken, {
      ...this.cookieOptions(),
      maxAge: session.accessExpiresIn * 1000,
    });
    this.setRefreshCookie(res, session.refreshToken);
  }

  private setRefreshCookie(res: Response, token: string): void {
    res.cookie(config.refreshCookieName, token, {
      ...this.cookieOptions(),
      maxAge: config.refreshTtlDays * 24 * 60 * 60 * 1000,
    });
  }

  private cookieOptions() {
    return {
      httpOnly: true,
      sameSite: config.cookieSameSite,
      secure: config.cookieSecure || config.cookieSameSite === 'none',
      domain: config.cookieDomain,
      path: '/',
    } as const;
  }
}
