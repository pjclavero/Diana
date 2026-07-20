import { Injectable } from '@nestjs/common';
import { CrudService } from '../../common/crud/crud.service';
import { PrismaService } from '../../common/prisma/prisma.service';

/** Datos de referencia: CRUD sin reglas de negocio propias. */
@Injectable()
export class GameModesService extends CrudService {
  constructor(prisma: PrismaService) {
    super(prisma.gameMode, 'gameMode', ['key', 'name', 'description', 'paramsSchema', 'enabled'], undefined);
  }
}
