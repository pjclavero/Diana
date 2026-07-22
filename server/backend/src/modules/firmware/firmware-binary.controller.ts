import type { Response } from 'express';
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/permissions.guard';
import { Public, RequirePermissions } from '../auth/roles.decorator';
import { FIRMWARE_MAX_BYTES_DEFAULT } from '../../config/configuration';
import { FirmwareBinaryService } from './firmware-binary.service';

class UploadFirmwareDto {
  @Matches(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/, { message: 'version debe ser semver (p. ej. 1.2.0)' })
  version!: string;

  @IsString()
  target_board!: string;

  @IsOptional()
  @IsString()
  signature?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

/**
 * Subida y descarga del binario de firmware (G-B).
 *
 * - `POST /api/firmware/upload` — admin (`firmware:write`), multipart con el `.bin`.
 * - `GET /api/firmware/:id/binary` — **público**: lo descarga el MÓDULO durante la
 *   OTA (no tiene JWT). Sólo entrega binarios ya registrados por su id.
 */
@ApiTags('firmware')
@Controller('firmware')
export class FirmwareBinaryController {
  constructor(
    private readonly binaries: FirmwareBinaryService,
    private readonly audit: AuditService,
  ) {}

  @Post('upload')
  @ApiBearerAuth()
  @RequirePermissions('firmware:write')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Sube el binario de una versión de firmware (calcula sha256/tamaño)' })
  // El límite del interceptor coincide con el máximo por defecto de config, para
  // no bufferizar en memoria un archivo que luego se rechazaría (OBS-2 supervisor).
  @UseInterceptors(FileInterceptor('binary', { limits: { fileSize: FIRMWARE_MAX_BYTES_DEFAULT } }))
  async upload(
    @UploadedFile() file: { buffer: Buffer } | undefined,
    @Body() dto: UploadFirmwareDto,
    @Req() req: { user: AuthenticatedUser },
  ) {
    const created = await this.binaries.upload(file?.buffer as Buffer, {
      version: dto.version,
      targetBoard: dto.target_board,
      signature: dto.signature ?? null,
      notes: dto.notes ?? null,
      createdBy: req.user.username,
    });
    await this.audit.record({
      user: req.user,
      action: 'firmware.upload',
      entity: 'firmwareVersion',
      entityId: created.id,
      after: { id: created.id, version: created.version, targetBoard: created.targetBoard, sha256: created.sha256, sizeBytes: created.sizeBytes, signed: created.signed },
    });
    return created;
  }

  @Get(':id/binary')
  @Public()
  @ApiOperation({ summary: 'Descarga el binario (lo usa el módulo en la OTA; sin autenticación)' })
  async download(
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { stream, sizeBytes, sha256, version } = await this.binaries.openForDownload(id);
    res.set({
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(sizeBytes),
      'Content-Disposition': `attachment; filename="firmware-${version}.bin"`,
      'X-Fw-Sha256': sha256,
    });
    return new StreamableFile(stream);
  }
}
