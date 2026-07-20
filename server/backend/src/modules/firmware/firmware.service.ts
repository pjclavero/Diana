import { Injectable } from '@nestjs/common';
import { CrudService } from '../../common/crud/crud.service';
import { PrismaService } from '../../common/prisma/prisma.service';

/** Datos de referencia: CRUD sin reglas de negocio propias. */
@Injectable()
export class FirmwareService extends CrudService {
  constructor(prisma: PrismaService) {
    super(prisma.firmwareVersion, 'firmwareVersion', ['version', 'targetBoard', 'url', 'sha256', 'sizeBytes', 'signature', 'signed', 'notes', 'createdBy'], undefined);
  }
}
