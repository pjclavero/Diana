import { Injectable } from '@nestjs/common';
import { CrudService } from '../../common/crud/crud.service';
import { PrismaService } from '../../common/prisma/prisma.service';

/** Datos de referencia: CRUD sin reglas de negocio propias. */
@Injectable()
export class ModulesService extends CrudService {
  constructor(prisma: PrismaService) {
    // `ownerId` NO es escribible por el CRUD: la propiedad se cambia sólo por
    // los endpoints link/unlink (ModuleOwnershipService), que aplican la regla
    // gestor⇄jugador y la auditoría. El `include` expone el dueño en lecturas.
    super(prisma.module, 'module', ['slug', 'targetSystemId', 'friendlyName', 'serial', 'mac', 'ip', 'hardwareRevision', 'firmwareVersion', 'role', 'selector', 'state', 'maintenance', 'configVersion'], {
      position: true,
      targets: true,
      owner: { select: { id: true, username: true, displayName: true, role: { select: { name: true } } } },
    });
  }
}
