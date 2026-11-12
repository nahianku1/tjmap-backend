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
  @IsArray()
  @ArrayMaxSize(64)
  @ValidateNested({ each: true })
  @Type(() => UserFibreDto)
  userFibres?: UserFibreDto[];
}

export class CreateLinkDto {
  @IsUUID()
  fromTjId: string;

  @IsUUID()
  toTjId: string;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  fibreId: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  cableType?: string;

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
}
