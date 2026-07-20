import { Injectable } from '@nestjs/common';
import { CrudService } from '../../common/crud/crud.service';
import { PrismaService } from '../../common/prisma/prisma.service';

/** Datos de referencia: CRUD sin reglas de negocio propias. */
@Injectable()
export class ModulesService extends CrudService {
  constructor(prisma: PrismaService) {
    super(prisma.module, 'module', ['slug', 'targetSystemId', 'friendlyName', 'serial', 'mac', 'ip', 'hardwareRevision', 'firmwareVersion', 'role', 'selector', 'state', 'maintenance', 'configVersion'], { position: true, targets: true });
  }
}
