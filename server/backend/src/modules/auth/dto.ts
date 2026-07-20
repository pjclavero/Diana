import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'admin' })
  @IsString()
  @MinLength(3)
  username!: string;

  @ApiProperty({ example: '••••••••••••' })
  @IsString()
  @MinLength(8)
  password!: string;
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  current_password!: string;

  @ApiProperty({ description: 'Mínimo 12 caracteres.' })
  @IsString()
  @MinLength(12)
  new_password!: string;
}
