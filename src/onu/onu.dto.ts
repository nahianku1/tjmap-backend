import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export const ONU_CORE_STATUSES = ['in_use', 'free', 'spliced', 'damaged'] as const;

export class OnuCoreDto {
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  label: string;

  @IsOptional()
  @Matches(/^#[0-9a-fA-F]{6}$/)
  color?: string;

  @IsOptional()
  @IsIn(ONU_CORE_STATUSES)
  status?: (typeof ONU_CORE_STATUSES)[number];
}

export class CreateOnuDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  username: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  macAddress?: string;

  /** 1–4094, or null for an untagged subscriber. Range-checked in the service. */
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsInt()
  vlanId?: number | null;

  @IsString()
  @MinLength(1)
  @MaxLength(60)
  fibreId: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(64)
  @ValidateNested({ each: true })
  @Type(() => OnuCoreDto)
  cores?: OnuCoreDto[];

  @IsOptional()
  @IsUUID()
  areaId?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  lat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  lng?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class UpdateOnuDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  username?: string;

  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @MaxLength(40)
  macAddress?: string | null;

  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsInt()
  vlanId?: number | null;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  fibreId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(64)
  @ValidateNested({ each: true })
  @Type(() => OnuCoreDto)
  cores?: OnuCoreDto[];

  @IsOptional()
  @IsUUID()
  areaId?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  lat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  lng?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
