import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

const CODE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export class CreateDistrictDto {
  @IsString()
  @MinLength(2)
  @MaxLength(48)
  name: string;

  @IsOptional()
  @IsString()
  @Matches(CODE, { message: 'District code may only contain letters, numbers, dashes and underscores' })
  @MaxLength(12)
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  description?: string;
}

export class UpdateDistrictDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(48)
  name?: string;

  @IsOptional()
  @IsString()
  @Matches(CODE, { message: 'District code may only contain letters, numbers, dashes and underscores' })
  @MaxLength(12)
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  description?: string;
}

export class CreateAreaDto {
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name: string;

  @IsOptional()
  @IsString()
  @Matches(CODE, { message: 'Area code may only contain letters, numbers, dashes and underscores' })
  @MaxLength(12)
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  description?: string;
}

export class UpdateAreaDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsString()
  @Matches(CODE, { message: 'Area code may only contain letters, numbers, dashes and underscores' })
  @MaxLength(12)
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  description?: string;
}
