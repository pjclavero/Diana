import { Module } from '@nestjs/common';
import { createCrudController } from '../../common/crud/crud.controller';
import { RoundsService } from './rounds.service';

export const RoundsController = createCrudController({
  path: 'rounds',
  tag: 'rounds',
  permission: 'rounds',
  entity: 'round',
  serviceToken: RoundsService,
});

@Module({
  controllers: [RoundsController],
  providers: [RoundsService],
  exports: [RoundsService],
})
export class RoundsModule {}
