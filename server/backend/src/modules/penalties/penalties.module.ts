import { Module } from '@nestjs/common';
import { createCrudController } from '../../common/crud/crud.controller';
import { PenaltiesService } from './penalties.service';

export const PenaltiesController = createCrudController({
  path: 'penalties',
  tag: 'penalties',
  permission: 'penalties',
  entity: 'penalty',
  serviceToken: PenaltiesService,
});

@Module({
  controllers: [PenaltiesController],
  providers: [PenaltiesService],
  exports: [PenaltiesService],
})
export class PenaltiesModule {}
