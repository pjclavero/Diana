import { createHash, randomUUID } from 'crypto';
import { createReadStream } from 'fs';
import { mkdir, stat, unlink, writeFile } from 'fs/promises';
import { join } from 'path';
import type { Readable } from 'stream';
import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AppConfig, CONFIG } from '../../config/configuration';

export interface UploadFirmwareInput {
  version: string;
  targetBoard: string;
  signature?: string | null;
  notes?: string | null;
  createdBy?: string | null;
}

/** semver del contrato (common.schema `semver`). Se valida aquí porque la OTA lo exige. */
const SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

/**
 * Almacenamiento y publicación del BINARIO de firmware (G-B, cierra el ciclo OTA).
 *
 * El binario se guarda en el volumen persistente `diana_firmware` (`FIRMWARE_DIR`,
 * `/app/firmware`) como `<id>.bin`. La `url` de la `FirmwareVersion` apunta a la
 * ruta pública `GET /api/firmware/:id/binary`, servida por este backend en la red
 * local, para que el módulo la descargue durante la OTA (contrato `ota-command`).
 */
@Injectable()
export class FirmwareBinaryService {
  private readonly logger = new Logger(FirmwareBinaryService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  private filePath(id: string): string {
    return join(this.config.firmware.dir, `${id}.bin`);
  }

  /** URL absoluta que el módulo usa para descargar (red local). */
  downloadUrl(id: string): string {
    return `${this.config.firmware.publicBaseUrl}/api/firmware/${id}/binary`;
  }

  /**
   * Sube un binario: calcula sha256 y tamaño reales del archivo, lo guarda y crea
   * la `FirmwareVersion` con la `url` de descarga. Con firma → `signed=true` (sólo
   * lo firmado se despliega, dosier 23.3). El sha256 se deriva del binario, no se
   * confía en un valor del cliente.
   */
  async upload(buffer: Buffer, input: UploadFirmwareInput) {
    if (!buffer || buffer.length === 0) throw new BadRequestException('El binario está vacío.');
    if (!SEMVER.test(input.version)) {
      throw new BadRequestException(`La versión '${input.version}' no es semver (p. ej. 1.2.0).`);
    }
    if (buffer.length > this.config.firmware.maxBytes) {
      throw new BadRequestException(`El binario supera el máximo permitido (${this.config.firmware.maxBytes} bytes).`);
    }

    const existing = await this.prisma.firmwareVersion.findUnique({
      where: { version_targetBoard: { version: input.version, targetBoard: input.targetBoard } },
    });
    if (existing) {
      throw new ConflictException(`Ya existe la versión ${input.version} para la placa ${input.targetBoard}.`);
    }

    const id = randomUUID();
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const sizeBytes = buffer.length;
    const signature = input.signature?.trim() || null;

    await mkdir(this.config.firmware.dir, { recursive: true });
    await writeFile(this.filePath(id), buffer, { mode: 0o640 });

    try {
      return await this.prisma.firmwareVersion.create({
        data: {
          id,
          version: input.version,
          targetBoard: input.targetBoard,
          url: this.downloadUrl(id),
          sha256,
          sizeBytes,
          signature,
          signed: signature !== null,
          notes: input.notes?.trim() || null,
          createdBy: input.createdBy ?? null,
        },
      });
    } catch (error) {
      // Si falla el registro, no dejamos el binario huérfano en disco.
      await unlink(this.filePath(id)).catch(() => undefined);
      throw error;
    }
  }

  /** Borra el binario en disco de una versión (idempotente). Se llama al borrar la
   *  `FirmwareVersion` para no dejar el `.bin` huérfano en el volumen (OBS-1 supervisor). */
  async deleteBinary(id: string): Promise<void> {
    await unlink(this.filePath(id)).catch(() => undefined);
  }

  /** Devuelve el stream del binario para descarga, o 404 si no existe en disco. */
  async openForDownload(id: string): Promise<{ stream: Readable; sizeBytes: number; sha256: string; version: string }> {
    const fw = await this.prisma.firmwareVersion.findUnique({ where: { id } });
    if (!fw) throw new NotFoundException(`Versión de firmware ${id} no encontrada`);
    const path = this.filePath(id);
    try {
      await stat(path);
    } catch {
      this.logger.warn(`Descarga solicitada de ${id} pero el binario no está en disco (${path}).`);
      throw new NotFoundException('El binario de esta versión no está disponible.');
    }
    return { stream: createReadStream(path), sizeBytes: fw.sizeBytes, sha256: fw.sha256, version: fw.version };
  }
}
