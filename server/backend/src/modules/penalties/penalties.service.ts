import { Injectable } from '@nestjs/common';
import { CrudService } from '../../common/crud/crud.service';
import { PrismaService } from '../../common/prisma/prisma.service';

/** Datos de referencia: CRUD sin reglas de negocio propias. */
@Injectable()
export class PenaltiesService extends CrudService {
  constructor(prisma: PrismaService) {
    super(prisma.penalty, 'penalty', ['roundId', 'participantId', 'hitEventId', 'kind', 'penaltyMs', 'reason', 'appliedBy'], undefined);
  }
}
