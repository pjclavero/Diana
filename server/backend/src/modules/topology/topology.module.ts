import { Module } from '@nestjs/common';
import { createCrudController } from '../../common/crud/crud.controller';
import { TopologyService } from './topology.service';

export const TopologyController = createCrudController({
  path: 'topology',
  tag: 'topology',
  permission: 'topology',
  entity: 'modulePosition',
  serviceToken: TopologyService,
});

@Module({
  controllers: [TopologyController],
  providers: [TopologyService],
  exports: [TopologyService],
})
export class TopologyModule {}
