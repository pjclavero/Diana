import { Injectable } from '@nestjs/common';
import { CrudService } from '../../common/crud/crud.service';
import { PrismaService } from '../../common/prisma/prisma.service';

/** Datos de referencia: CRUD sin reglas de negocio propias. */
@Injectable()
export class RoundsService extends CrudService {
  constructor(prisma: PrismaService) {
    super(prisma.round, 'round', ['gameId', 'roundIndex', 'phase', 'mode', 'seed', 'plan', 'countdownMs', 'timeLimitMs', 'penaltyMs', 'strictOrder', 'reactionDelayMinMs', 'reactionDelayMaxMs'], undefined);
  }
}
