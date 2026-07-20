import { Module } from '@nestjs/common';
import { createCrudController } from '../../common/crud/crud.controller';
import { ModulesService } from './modules.service';

export const ModulesController = createCrudController({
  path: 'modules',
  tag: 'modules',
  permission: 'modules',
  entity: 'module',
  serviceToken: ModulesService,
});

@Module({
  controllers: [ModulesController],
  providers: [ModulesService],
  exports: [ModulesService],
})
export class ModulesModule {}
