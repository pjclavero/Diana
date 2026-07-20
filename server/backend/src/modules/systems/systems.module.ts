import { Module } from '@nestjs/common';
import { createCrudController } from '../../common/crud/crud.controller';
import { SystemsService } from './systems.service';

export const SystemsController = createCrudController({
  path: 'systems',
  tag: 'systems',
  permission: 'systems',
  entity: 'targetSystem',
  serviceToken: SystemsService,
});

@Module({
  controllers: [SystemsController],
  providers: [SystemsService],
  exports: [SystemsService],
})
export class SystemsModule {}
