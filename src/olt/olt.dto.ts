import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export const ETHERNET_SPEEDS = ['1G', '10G', '40G', '100G'] as const;

export class PonPortDto {
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  label: string;

  /** Optional friendly name shown alongside the hardware port label. */
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @MaxLength(60)
  name?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-40)
  @Max(30)
  outputDbm?: number | null;

  /** Optional service VLAN carried by this port. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(4094)
  vlanId?: number | null;
}

export class EthernetPortDto {
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  label: string;

  @IsIn(ETHERNET_SPEEDS)
  speed: '1G' | '10G' | '40G' | '100G';

  /** Optional service VLAN carried by this port. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(4094)
  vlanId?: number | null;
}

export class CreateOltDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  oltType?: string;

  /** Primary PON port. Derived from the first `ponPorts` entry when that list is sent. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  ponPort?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  uplinkPort?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(64)
  @ValidateNested({ each: true })
  @Type(() => PonPortDto)
  ponPorts?: PonPortDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(64)
  @ValidateNested({ each: true })
  @Type(() => EthernetPortDto)
  ethernetPorts?: EthernetPortDto[];

  /** Fibre cable feeding the cabinet. Optional; derived from the connected link when one exists. */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  fibreId?: string;

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

export class UpdateOltDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  oltType?: string;

  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @MaxLength(40)
  ponPort?: string | null;

  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @MaxLength(40)
  uplinkPort?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(64)
  @ValidateNested({ each: true })
  @Type(() => PonPortDto)
  ponPorts?: PonPortDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(64)
  @ValidateNested({ each: true })
  @Type(() => EthernetPortDto)
  ethernetPorts?: EthernetPortDto[];

  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @MaxLength(80)
  fibreId?: string | null;

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
