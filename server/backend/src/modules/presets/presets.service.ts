import { Injectable } from '@nestjs/common';
import { CrudService } from '../../common/crud/crud.service';
import { PrismaService } from '../../common/prisma/prisma.service';

/** Datos de referencia: CRUD sin reglas de negocio propias. */
@Injectable()
export class PresetsService extends CrudService {
  constructor(prisma: PrismaService) {
    super(prisma.gamePreset, 'gamePreset', ['name', 'description', 'gameModeId', 'config', 'isSample', 'createdBy'], undefined);
  }
}
