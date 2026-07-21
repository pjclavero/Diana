import { Module } from '@nestjs/common';
import { createCrudController } from '../../common/crud/crud.controller';
import { ModulesService } from './modules.service';
import { ModuleOwnershipController } from './module-ownership.controller';
import { ModuleOwnershipService } from './module-ownership.service';

export const ModulesController = createCrudController({
  path: 'modules',
  tag: 'modules',
  permission: 'modules',
  entity: 'module',
  serviceToken: ModulesService,
});

@Module({
  // El controlador de propiedad va PRIMERO para que su ruta estática
  // `GET /modules/mine` se resuelva antes que el `GET /modules/:id` del CRUD.
  controllers: [ModuleOwnershipController, ModulesController],
  providers: [ModulesService, ModuleOwnershipService],
  exports: [ModulesService],
})
export class ModulesModule {}
