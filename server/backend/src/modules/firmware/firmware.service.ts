import { Injectable } from '@nestjs/common';
import { CrudService } from '../../common/crud/crud.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { FirmwareBinaryService } from './firmware-binary.service';

/** Datos de referencia: CRUD sin reglas de negocio propias, salvo que al borrar
 *  una versión se retira también su binario del volumen (OBS-1 supervisor). */
@Injectable()
export class FirmwareService extends CrudService {
  constructor(
    prisma: PrismaService,
    private readonly binaries: FirmwareBinaryService,
  ) {
    super(prisma.firmwareVersion, 'firmwareVersion', ['version', 'targetBoard', 'url', 'sha256', 'sizeBytes', 'signature', 'signed', 'notes', 'createdBy'], undefined);
  }

  async remove(id: string): Promise<{ id: string; deleted: true }> {
    const result = await super.remove(id);
    await this.binaries.deleteBinary(id);
    return result;
  }
}
