import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const MOBILE_PATTERN = /^\+?[0-9][0-9\s\-()]{6,19}$/;

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(160)
  email?: string;

  @IsOptional()
  @Matches(MOBILE_PATTERN, { message: 'Mobile number must be a valid phone number' })
  mobile?: string;
}

export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  currentPassword: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  @MaxLength(128)
  newPassword: string;
}

export class CreateUserDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name: string;

  @IsEmail()
  @MaxLength(160)
  email: string;

  @Matches(MOBILE_PATTERN, { message: 'Mobile number must be a valid phone number' })
  mobile: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  @MaxLength(128)
  password: string;

  @IsIn(['user', 'admin'])
  role: 'user' | 'admin';
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(160)
  email?: string;

  @IsOptional()
  @Matches(MOBILE_PATTERN, { message: 'Mobile number must be a valid phone number' })
  mobile?: string;

  @IsOptional()
  @IsIn(['user', 'admin'])
  role?: 'user' | 'admin';

  @IsOptional()
  @IsBoolean()
  blocked?: boolean;
}

export class ResetPasswordDto {
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  @MaxLength(128)
  newPassword: string;
}

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(1)
  password: string;
}

export class RefreshDto {
  @IsOptional()
  @IsString()
  refreshToken?: string;
}
