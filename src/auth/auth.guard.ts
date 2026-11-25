import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { ROLES_KEY } from './roles.decorator';
import { Role } from './auth.types';
import { config } from '../config';

export interface AuthenticatedRequest extends Request {
  user?: { id: string; email: string; name: string; role: Role };
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization ?? '';
    const [scheme, bearer] = header.split(' ');
    // The access token is also stored in an httpOnly cookie, so a browser session
    // survives a reload even before the client holds a token in memory.
    const token =
      (scheme === 'Bearer' && bearer ? bearer : null) ??
      (request.cookies as Record<string, string> | undefined)?.[config.accessCookieName] ??
      null;
    if (!token) {
      throw new ForbiddenException('Authentication required');
    }
    const payload = await this.auth.verifyAccessToken(token);
    request.user = {
      id: payload.sub,
      email: payload.email,
      name: payload.name,
      role: payload.role,
    };
    return true;
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const role = request.user?.role;
    if (!role || !required.includes(role)) {
      throw new ForbiddenException('Your account has read-only access');
    }
    return true;
  }
}
