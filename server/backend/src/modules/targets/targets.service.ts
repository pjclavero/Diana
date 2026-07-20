import { Injectable } from '@nestjs/common';
import { CrudService } from '../../common/crud/crud.service';
import { PrismaService } from '../../common/prisma/prisma.service';

/** Datos de referencia: CRUD sin reglas de negocio propias. */
@Injectable()
export class TargetsService extends CrudService {
  constructor(prisma: PrismaService) {
    super(prisma.target, 'target', ['moduleId', 'targetIndex', 'label', 'enabled', 'state'], undefined);
  }
}
