import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export const ONU_CORE_STATUSES = ['in_use', 'free', 'spliced', 'damaged'] as const;

/** Internal key of the ONU's one PON input port; never shown as a core name. */
export const ONU_PORT_LABEL = 'PON';

export const PON_TYPES = ['epon', 'gpon'] as const;

/** ODN loss windows the ONU optic is specified for. */
export const ONU_CLASSES = ['A', 'B', 'B+', 'C', 'C+', 'C++', 'PX10', 'PX20', 'PX30'] as const;

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

  /** Drop cable feeding the ONU. Optional; taken from the connected link when one exists. */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  fibreId?: string;

  @IsOptional()
  @IsIn(PON_TYPES)
  ponType?: (typeof PON_TYPES)[number];

  @IsOptional()
  @IsIn(ONU_CLASSES)
  onuClass?: (typeof ONU_CLASSES)[number];

  @IsOptional()
  @IsUUID()
  areaId?: string | null;

  @IsOptional()
  @IsUUID()
  subAreaId?: string | null;

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
  @IsIn(PON_TYPES)
  ponType?: (typeof PON_TYPES)[number];

  @IsOptional()
  @IsIn(ONU_CLASSES)
  onuClass?: (typeof ONU_CLASSES)[number];

  @IsOptional()
  @IsUUID()
  areaId?: string | null;

  @IsOptional()
  @IsUUID()
  subAreaId?: string | null;

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
