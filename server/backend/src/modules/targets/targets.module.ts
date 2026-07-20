import { Module } from '@nestjs/common';
import { createCrudController } from '../../common/crud/crud.controller';
import { TargetsService } from './targets.service';

export const TargetsController = createCrudController({
  path: 'targets',
  tag: 'targets',
  permission: 'targets',
  entity: 'target',
  serviceToken: TargetsService,
});

@Module({
  controllers: [TargetsController],
  providers: [TargetsService],
  exports: [TargetsService],
})
export class TargetsModule {}
