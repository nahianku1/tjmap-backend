import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { hash, verify } from '@node-rs/argon2';
import { createHash, randomUUID } from 'crypto';
import { DatabaseService } from '../database/database.service';
import { config } from '../config';
import { LoginDto, SignupDto } from './auth.dto';
import { AccessPayload, PublicUser, RefreshPayload, UserRecord } from './auth.types';

const ARGON2_OPTIONS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

@Injectable()
export class AuthService {
  constructor(
    private readonly db: DatabaseService,
    private readonly jwt: JwtService,
  ) {}

  async signup(dto: SignupDto) {
    const email = dto.email.trim().toLowerCase();
    const existing = await this.db.query<{ id: string }>(
      'SELECT id FROM users WHERE lower(email) = $1',
      [email],
    );
    if (existing.length > 0) {
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await hash(dto.password, ARGON2_OPTIONS);
    const rows = await this.db.query<UserRecord>(
      `INSERT INTO users (name, email, mobile, password_hash, role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [dto.name.trim(), email, dto.mobile.trim(), passwordHash, dto.role],
    );

    return this.issueSession(rows[0]);
  }

  async login(dto: LoginDto) {
    const rows = await this.db.query<UserRecord>(
      'SELECT * FROM users WHERE lower(email) = $1',
      [dto.email.trim().toLowerCase()],
    );
    const user = rows[0];
    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }
    const valid = await verify(user.password_hash, dto.password).catch(() => false);
    if (!valid) {
      throw new UnauthorizedException('Invalid email or password');
    }
    return this.issueSession(user);
  }

  async rotateRefreshToken(token: string) {
    let payload: RefreshPayload;
    try {
      payload = await this.jwt.verifyAsync<RefreshPayload>(token, {
        secret: config.refreshSecret,
      });
    } catch {
      throw new UnauthorizedException('Session expired, please sign in again');
    }

    const rows = await this.db.query<{
      id: string;
      user_id: string;
      family_id: string;
      revoked_at: Date | null;
      expires_at: Date;
    }>('SELECT id, user_id, family_id, revoked_at, expires_at FROM refresh_tokens WHERE token_hash = $1', [
      sha256(token),
    ]);
    const record = rows[0];

    if (!record) {
      throw new UnauthorizedException('Session expired, please sign in again');
    }

    if (record.revoked_at) {
      // Token reuse: assume theft and burn the whole session family.
      await this.db.query(
        'UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL',
        [record.family_id],
      );
      throw new UnauthorizedException('Session revoked, please sign in again');
    }

    if (new Date(record.expires_at).getTime() < Date.now()) {
      await this.db.query('UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1', [record.id]);
      throw new UnauthorizedException('Session expired, please sign in again');
    }

    const users = await this.db.query<UserRecord>('SELECT * FROM users WHERE id = $1', [
      payload.sub,
    ]);
    if (users.length === 0) {
      throw new UnauthorizedException('Account no longer available');
    }

    await this.db.query('UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1', [record.id]);
    return this.issueSession(users[0], record.family_id, record.id);
  }

  async logout(token?: string): Promise<void> {
    if (!token) return;
    await this.db.query(
      'UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL',
      [sha256(token)],
    );
  }

  async me(userId: string): Promise<PublicUser> {
    const rows = await this.db.query<UserRecord>('SELECT * FROM users WHERE id = $1', [userId]);
    if (rows.length === 0) {
      throw new UnauthorizedException('Account no longer available');
    }
    return this.toPublicUser(rows[0]);
  }

  async verifyAccessToken(token: string): Promise<AccessPayload> {
    try {
      return await this.jwt.verifyAsync<AccessPayload>(token, {
        secret: config.accessSecret,
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
  }

  private async issueSession(user: UserRecord, familyId: string = randomUUID(), replacedId?: string) {
    const accessPayload: AccessPayload = {
      sub: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      type: 'access',
    };
    const accessToken = await this.jwt.signAsync(accessPayload, {
      secret: config.accessSecret,
      expiresIn: config.accessTtlSeconds,
    });

    const jti = randomUUID();
    const refreshPayload: RefreshPayload = {
      sub: user.id,
      family: familyId,
      jti,
      type: 'refresh',
    };
    const refreshToken = await this.jwt.signAsync(refreshPayload, {
      secret: config.refreshSecret,
      expiresIn: `${config.refreshTtlDays}d`,
    });

    await this.db.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, family_id, expires_at, jti)
       VALUES ($1, $2, $3, now() + ($4 || ' days')::interval, $5)`,
      [user.id, sha256(refreshToken), familyId, String(config.refreshTtlDays), jti],
    );

    if (replacedId) {
      await this.db.query('UPDATE refresh_tokens SET replaced_by = $1 WHERE id = $2', [jti, replacedId]);
    }

    await this.db.query(
      'DELETE FROM refresh_tokens WHERE user_id = $1 AND expires_at < now() - interval \'7 days\'',
      [user.id],
    );

    return {
      accessToken,
      refreshToken,
      accessExpiresIn: config.accessTtlSeconds,
      user: this.toPublicUser(user),
    };
  }

  private toPublicUser(user: UserRecord): PublicUser {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      mobile: user.mobile,
      role: user.role,
      createdAt: new Date(user.created_at).toISOString(),
    };
  }
}
