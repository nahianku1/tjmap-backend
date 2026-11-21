import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

const HEX_COLOR = /^#([0-9a-fA-F]{6})$/;

export class CoreDto {
  @IsString()
  @MaxLength(40)
  label: string;

  @Matches(HEX_COLOR, { message: 'Core colour must be a hex value like #22d3ee' })
  color: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(288)
  count: number;

  @IsOptional()
  @IsString()
  @IsIn(['in_use', 'free', 'spliced', 'damaged'])
  status?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  powerDbm?: number;

  /** Link that currently patches this core; set by the link service, must survive TJ saves. */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  connectedLinkId?: string | null;
}

export class SplitterDto {
  @IsBoolean()
  enabled: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  ratio?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  inputCoreLabel?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  inputPowerDbm?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  lossDb?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  outputPowerDbm?: number;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  powerStatus?: string;

  @IsArray()
  @ArrayMaxSize(64)
  @ValidateNested({ each: true })
  @Type(() => CoreDto)
  outputs: CoreDto[];
}

export class CutDataDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  faultDistanceMeters?: number;

  @IsOptional()
  @IsString()
  cutTime?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  damagedCores?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  restoredCores?: number;

  @IsOptional()
  @IsString()
  @IsIn(['cut_unresolved', 'splicing_in_progress', 'restored'])
  repairStatus?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  restorationNotes?: string;
}

export class PonDataDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  oltName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  ponPort?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  wavelength?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  inputPowerDbm?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  calculatedOutputDbm?: number;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  powerStatus?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  budgetMarginDb?: number;
}

export class UserFibreCoreDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  coreIndex: number;

  @IsString()
  @MaxLength(40)
  label: string;

  @Matches(HEX_COLOR, { message: 'Core colour must be a hex value like #22d3ee' })
  color: string;

  @IsOptional()
  @IsString()
  @IsIn(['free', 'in_use', 'damaged', 'spliced'])
  status?: string;

  @IsOptional()
  @IsBoolean()
  connectedToOutputCore?: boolean;
}

export class UserFibreDto {
  @IsString()
  @MaxLength(80)
  id: string;

  @IsString()
  @MaxLength(80)
  outputCoreLabel: string;

  @IsString()
  @MaxLength(120)
  label: string;

  @Matches(HEX_COLOR, { message: 'Cable colour must be a hex value like #22d3ee' })
  color: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(48)
  coreCount: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  connectedCoreIndex?: number | null;

  @IsArray()
  @ArrayMaxSize(48)
  @ValidateNested({ each: true })
  @Type(() => UserFibreCoreDto)
  cores: UserFibreCoreDto[];
}

export class CreateTjDto {
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  code: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @IsIn(['box', 'cut', 'pon_power'])
  tjType?: 'box' | 'cut' | 'pon_power';

  @Type(() => Number)
  @IsLatitude()
  lat: number;

  @Type(() => Number)
  @IsLongitude()
  lng: number;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  fibreId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  inputPowerDbm?: number;

  @IsArray()
  @ArrayMaxSize(48)
  @ValidateNested({ each: true })
  @Type(() => CoreDto)
  cores: CoreDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(64)
  @ValidateNested({ each: true })
  @Type(() => CoreDto)
  outputCores?: CoreDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => SplitterDto)
  splitter?: SplitterDto;

  /** Several splitters can sit in the same joint (cascaded or parallel legs). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @ValidateNested({ each: true })
  @Type(() => SplitterDto)
  splitters?: SplitterDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => CutDataDto)
  cutData?: CutDataDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => PonDataDto)
  ponData?: PonDataDto;

  @IsOptional()
  @IsBoolean()
  isCut?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  cutReason?: string;

  @IsOptional()
  @IsIn(['minor', 'major', 'outage'])
  cutSeverity?: 'minor' | 'major' | 'outage';

  @IsOptional()
  @IsUUID()
  areaId?: string | null;

  @IsOptional()
  @IsUUID()
  subAreaId?: string | null;

  @IsOptional()
  @IsUUID()
  oltId?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(64)
  @ValidateNested({ each: true })
  @Type(() => UserFibreDto)
  userFibres?: UserFibreDto[];
}

export class UpdateTjDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @IsIn(['box', 'cut', 'pon_power'])
  tjType?: 'box' | 'cut' | 'pon_power';

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
  @MaxLength(240)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  fibreId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  inputPowerDbm?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(48)
  @ValidateNested({ each: true })
  @Type(() => CoreDto)
  cores?: CoreDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(64)
  @ValidateNested({ each: true })
  @Type(() => CoreDto)
  outputCores?: CoreDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => SplitterDto)
  splitter?: SplitterDto;

  /** Several splitters can sit in the same joint (cascaded or parallel legs). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @ValidateNested({ each: true })
  @Type(() => SplitterDto)
  splitters?: SplitterDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => CutDataDto)
  cutData?: CutDataDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => PonDataDto)
  ponData?: PonDataDto;

  @IsOptional()
  @IsBoolean()
  isCut?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  cutReason?: string;

  @IsOptional()
  @IsIn(['minor', 'major', 'outage'])
  cutSeverity?: 'minor' | 'major' | 'outage';

  @IsOptional()
  @IsUUID()
  areaId?: string | null;

  @IsOptional()
  @IsUUID()
  subAreaId?: string | null;

  @IsOptional()
  @IsUUID()
  oltId?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(64)
  @ValidateNested({ each: true })
  @Type(() => UserFibreDto)
  userFibres?: UserFibreDto[];
}

export class ChangeOutputCoreDto {
  /** Output core currently carrying the cables (the one that went faulty). */
  @IsString()
  @MaxLength(40)
  fromLabel: string;

  /** Free output core the cables are moved onto. */
  @IsString()
  @MaxLength(40)
  toLabel: string;
}

export class LinkCoreDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(288)
  index?: number;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  label?: string;

  @IsOptional()
  @Matches(HEX_COLOR, { message: 'Core colour must be a hex value like #22d3ee' })
  color?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  fromCoreLabel?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  toCoreLabel?: string | null;

  /** Extra loss on this strand (dB) — a repaired, bent or degraded core carries more. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(99)
  lossDb?: number;
}

export class LinkPathPointDto {
  @Type(() => Number)
  @IsLatitude()
  lat: number;

  @Type(() => Number)
  @IsLongitude()
  lng: number;
}

export class CreateLinkDto {
  /** Endpoint on the from side: exactly one of `fromTjId`, `fromOltId` or `fromOnuId`. */
  @IsOptional()
  @IsUUID()
  fromTjId?: string;

  @IsOptional()
  @IsUUID()
  fromOltId?: string;

  @IsOptional()
  @IsUUID()
  fromOnuId?: string;

  @IsOptional()
  @IsUUID()
  toTjId?: string;

  @IsOptional()
  @IsUUID()
  toOltId?: string;

  @IsOptional()
  @IsUUID()
  toOnuId?: string;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  fibreId: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  cableType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  fromCoreLabel?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  toCoreLabel?: string | null;

  /** Sub-area this span is filed under (organisational only). */
  @IsOptional()
  @IsUUID()
  subAreaId?: string | null;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(288)
  coreCount: number;

  @IsOptional()
  @IsIn(['active', 'cut'])
  status?: 'active' | 'cut';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  /** Optional map colour for this link; null/absent uses the default styling. */
  @IsOptional()
  @Matches(HEX_COLOR, { message: 'Link colour must be a hex value like #22d3ee' })
  color?: string;

  /** Fibre attenuation for this span at the working wavelength (typically 0.30–0.40 dB/km). */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(5)
  attenuationDbPerKm?: number;

  /** Fusion splices inside this span; each contributes a fixed splice loss. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(288)
  spliceCount?: number;

  /** Total connector/patch-panel loss at both ends of this span. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(20)
  connectionLossDb?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(288)
  @ValidateNested({ each: true })
  @Type(() => LinkCoreDto)
  cores?: LinkCoreDto[];

  /** Hand-drawn duct route between the endpoints (intermediate waypoints only). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => LinkPathPointDto)
  path?: LinkPathPointDto[];
}

export class UpdateLinkDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  fibreId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  cableType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  fromCoreLabel?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  toCoreLabel?: string | null;

  @IsOptional()
  @IsUUID()
  subAreaId?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(288)
  coreCount?: number;

  @IsOptional()
  @IsIn(['active', 'cut'])
  status?: 'active' | 'cut';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  /** Sending null clears the custom colour and restores the default look. */
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @Matches(HEX_COLOR, { message: 'Link colour must be a hex value like #22d3ee' })
  color?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(5)
  attenuationDbPerKm?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(288)
  spliceCount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(20)
  connectionLossDb?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(288)
  @ValidateNested({ each: true })
  @Type(() => LinkCoreDto)
  cores?: LinkCoreDto[];

  /** Replaces the drawn route; an empty array restores the straight span. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => LinkPathPointDto)
  path?: LinkPathPointDto[];
}
