import { Injectable } from '@nestjs/common';
import { CrudService } from '../../common/crud/crud.service';
import { PrismaService } from '../../common/prisma/prisma.service';

/** Datos de referencia: CRUD sin reglas de negocio propias. */
@Injectable()
export class ParticipantsService extends CrudService {
  constructor(prisma: PrismaService) {
    super(prisma.participant, 'participant', ['gameId', 'roundId', 'playerId', 'teamId', 'slot', 'lane'], { player: true, team: true });
  }
}
