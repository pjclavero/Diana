import { Module } from '@nestjs/common';
import { createCrudController } from '../../common/crud/crud.controller';
import { TopologyService } from './topology.service';
import { TopologyPanelsController } from './topology-panels.controller';
import { TopologyPanelsService } from './topology-panels.service';

export const TopologyController = createCrudController({
  path: 'topology',
  tag: 'topology',
  permission: 'topology',
  entity: 'modulePosition',
  serviceToken: TopologyService,
});

@Module({
  // El controlador de paneles va ANTES para que `panels` no lo capture `:id`.
  controllers: [TopologyPanelsController, TopologyController],
  providers: [TopologyService, TopologyPanelsService],
  exports: [TopologyService, TopologyPanelsService],
})
export class TopologyModule {}
