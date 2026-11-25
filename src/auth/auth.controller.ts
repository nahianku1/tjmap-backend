import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto, RefreshDto, SignupDto } from './auth.dto';
import { JwtAuthGuard, AuthenticatedRequest } from './auth.guard';
import { config } from '../config';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('signup')
  async signup(@Body() dto: SignupDto, @Res({ passthrough: true }) res: Response) {
    const session = await this.auth.signup(dto);
    this.setSessionCookies(res, session);
    return { accessToken: session.accessToken, expiresIn: session.accessExpiresIn, user: session.user };
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
