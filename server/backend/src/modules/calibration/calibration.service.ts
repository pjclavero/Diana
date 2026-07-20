import { Injectable } from '@nestjs/common';
import { CrudService } from '../../common/crud/crud.service';
import { PrismaService } from '../../common/prisma/prisma.service';

/** Datos de referencia: CRUD sin reglas de negocio propias. */
@Injectable()
export class CalibrationService extends CrudService {
  constructor(prisma: PrismaService) {
    super(prisma.sensorCalibration, 'sensorCalibration', ['targetId', 'threshold', 'hysteresis', 'noiseFloor', 'blankingUs', 'groupWindowUs', 'neighbourRatio', 'enabled', 'configVersion', 'source', 'validated', 'calibratedBy'], undefined);
  }
}
