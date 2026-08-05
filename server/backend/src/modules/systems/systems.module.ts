import { Module } from '@nestjs/common';
import { createCrudController } from '../../common/crud/crud.controller';
import { SystemsService } from './systems.service';
import { SystemStatusController } from './system-status.controller';
import { SystemStatusService } from './system-status.service';

export const SystemsController = createCrudController({
  path: 'systems',
  tag: 'systems',
  permission: 'systems',
  entity: 'targetSystem',
  serviceToken: SystemsService,
});

@Module({
  // El controlador de estado va PRIMERO por el mismo motivo que en
  // `ModulesModule`: rutas estáticas antes que el `GET /systems/:id` del CRUD,
  // aunque aquí no colisionen (distinto número de segmentos).
  controllers: [SystemStatusController, SystemsController],
  providers: [SystemsService, SystemStatusService],
  exports: [SystemsService],
})
export class SystemsModule {}
