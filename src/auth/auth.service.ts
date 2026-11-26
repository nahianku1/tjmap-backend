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
import {
  ChangePasswordDto,
  CreateUserDto,
  LoginDto,
  ResetPasswordDto,
  UpdateProfileDto,
  UpdateUserDto,
} from './auth.dto';
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

  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<PublicUser> {
    const rows = await this.db.query<UserRecord>('SELECT * FROM users WHERE id = $1', [userId]);
    const user = rows[0];
    if (!user) {
      throw new UnauthorizedException('Account no longer available');
    }

    const name = dto.name?.trim() ?? user.name;
    const email = dto.email?.trim().toLowerCase() ?? user.email;
    const mobile = dto.mobile?.trim() ?? user.mobile;

    if (email !== user.email) {
      const existing = await this.db.query<{ id: string }>(
        'SELECT id FROM users WHERE lower(email) = $1 AND id <> $2',
        [email, userId],
      );
      if (existing.length > 0) {
        throw new ConflictException('An account with this email already exists');
      }
    }

    const updated = await this.db.query<UserRecord>(
      'UPDATE users SET name = $2, email = $3, mobile = $4, updated_at = now() WHERE id = $1 RETURNING *',
      [userId, name, email, mobile],
    );
    return this.toPublicUser(updated[0]);
  }

  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    const rows = await this.db.query<UserRecord>('SELECT * FROM users WHERE id = $1', [userId]);
    const user = rows[0];
    if (!user) {
      throw new UnauthorizedException('Account no longer available');
    }
    const valid = await verify(user.password_hash, dto.currentPassword).catch(() => false);
    if (!valid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    const passwordHash = await hash(dto.newPassword, ARGON2_OPTIONS);
    await this.db.query('UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1', [
      userId,
      passwordHash,
    ]);
    // A password change invalidates every session, including this one.
    await this.db.query(
      'UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
      [userId],
    );
  }

  async listUsers(): Promise<PublicUser[]> {
    const rows = await this.db.query<UserRecord>(
      'SELECT * FROM users ORDER BY created_at ASC',
    );
    return rows.map((row) => this.toPublicUser(row));
  }

  async createUser(dto: CreateUserDto): Promise<PublicUser> {
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
    return this.toPublicUser(rows[0]);
  }

  async updateUser(actorId: string, userId: string, dto: UpdateUserDto): Promise<PublicUser> {
    if (userId === actorId) {
      throw new ConflictException('You cannot change your own role or block your own account');
    }

    const rows = await this.db.query<UserRecord>('SELECT * FROM users WHERE id = $1', [userId]);
    const target = rows[0];
    if (!target) {
      throw new UnauthorizedException('Account no longer available');
    }

    const nextRole = dto.role ?? target.role;
    const nextBlocked = dto.blocked ?? Boolean(target.blocked_at);
    const nextName = dto.name?.trim() ?? target.name;
    const nextEmail = dto.email?.trim().toLowerCase() ?? target.email;
    const nextMobile = dto.mobile?.trim() ?? target.mobile;

    const wasActiveAdmin = target.role === 'admin' && !target.blocked_at;
    const willBeActiveAdmin = nextRole === 'admin' && !nextBlocked;

    if (wasActiveAdmin && !willBeActiveAdmin) {
      const admins = await this.db.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM users
         WHERE role = 'admin' AND blocked_at IS NULL AND id <> $1`,
        [userId],
      );
      if (Number(admins[0]?.count ?? 0) === 0) {
        throw new ConflictException('At least one active admin account must remain');
      }
    }

    if (nextEmail !== target.email) {
      const existing = await this.db.query<{ id: string }>(
        'SELECT id FROM users WHERE lower(email) = $1 AND id <> $2',
        [nextEmail, userId],
      );
      if (existing.length > 0) {
        throw new ConflictException('An account with this email already exists');
      }
    }

    const updated = await this.db.query<UserRecord>(
      `UPDATE users
       SET name = $2,
           email = $3,
           mobile = $4,
           role = $5,
           blocked_at = CASE WHEN $6 THEN COALESCE(blocked_at, now()) ELSE NULL END,
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [userId, nextName, nextEmail, nextMobile, nextRole, nextBlocked],
    );

    // Role, block and email changes take effect immediately: kill every session
    // so the next login issues a token with the new role (or none at all).
    await this.db.query(
      'UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
      [userId],
    );

    return this.toPublicUser(updated[0]);
  }

  async resetUserPassword(actorId: string, userId: string, dto: ResetPasswordDto): Promise<void> {
    if (userId === actorId) {
      throw new ConflictException('Use the change-password form to update your own password');
    }
    const rows = await this.db.query<UserRecord>('SELECT id FROM users WHERE id = $1', [userId]);
    if (rows.length === 0) {
      throw new UnauthorizedException('Account no longer available');
    }

    const passwordHash = await hash(dto.newPassword, ARGON2_OPTIONS);
    await this.db.query('UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1', [
      userId,
      passwordHash,
    ]);
    await this.db.query(
      'UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
      [userId],
    );
  }

  async deleteUser(actorId: string, userId: string): Promise<void> {
    if (userId === actorId) {
      throw new ConflictException('You cannot delete your own account');
    }

    const rows = await this.db.query<UserRecord>('SELECT * FROM users WHERE id = $1', [userId]);
    const target = rows[0];
    if (!target) {
      throw new UnauthorizedException('Account no longer available');
    }

    if (target.role === 'admin' && !target.blocked_at) {
      const admins = await this.db.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM users
         WHERE role = 'admin' AND blocked_at IS NULL AND id <> $1`,
        [userId],
      );
      if (Number(admins[0]?.count ?? 0) === 0) {
        throw new ConflictException('At least one active admin account must remain');
      }
    }

    await this.db.query('DELETE FROM users WHERE id = $1', [userId]);
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
    if (user.blocked_at) {
      throw new UnauthorizedException('This account has been blocked. Contact an administrator.');
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
    if (users.length === 0 || users[0].blocked_at) {
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
    if (rows.length === 0 || rows[0].blocked_at) {
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
      blocked: Boolean(user.blocked_at),
      createdAt: new Date(user.created_at).toISOString(),
    };
  }
}
