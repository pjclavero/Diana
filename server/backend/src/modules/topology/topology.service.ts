import { Injectable } from '@nestjs/common';
import { CrudService } from '../../common/crud/crud.service';
import { PrismaService } from '../../common/prisma/prisma.service';

/** Datos de referencia: CRUD sin reglas de negocio propias. */
@Injectable()
export class TopologyService extends CrudService {
  constructor(prisma: PrismaService) {
    super(prisma.modulePosition, 'modulePosition', ['moduleId', 'targetSystemId', 'x', 'y', 'rotation', 'assignedBy'], { module: true });
  }
}
