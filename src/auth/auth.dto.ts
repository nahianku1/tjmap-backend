import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class SignupDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name: string;

  @IsEmail()
  @MaxLength(160)
  email: string;

  @Matches(/^\+?[0-9][0-9\s\-()]{6,19}$/, {
    message: 'Mobile number must be a valid phone number',
  })
  mobile: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  @MaxLength(128)
  password: string;

  @IsIn(['user', 'admin'])
  role: 'user' | 'admin';
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
