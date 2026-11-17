import { IsEmail, IsString, MinLength, IsObject, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class DeviceMetadataDto {
  @IsString()
  platform;

  @IsString()
  device;

  @IsString()
  appVersion;
}

export class RegisterDto {
  @IsEmail()
  email;

  @IsString()
  @MinLength(6, { message: 'Password must be at least 6 characters' })
  password;

  @IsObject()
  @ValidateNested()
  @Type(() => DeviceMetadataDto)
  metadata;
}

export class LoginDto {
  @IsEmail()
  email;

  @IsString()
  password;

  @IsObject()
  @ValidateNested()
  @Type(() => DeviceMetadataDto)
  metadata;
}