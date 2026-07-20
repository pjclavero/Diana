import { Injectable } from '@nestjs/common';
import { CrudService } from '../../common/crud/crud.service';
import { PrismaService } from '../../common/prisma/prisma.service';

/** Datos de referencia: CRUD sin reglas de negocio propias. */
@Injectable()
export class SystemsService extends CrudService {
  constructor(prisma: PrismaService) {
    super(prisma.targetSystem, 'targetSystem', ['slug', 'name', 'description', 'state', 'coordinatorModuleId', 'modulesExpected'], undefined);
  }
}
