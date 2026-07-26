import { Module } from '@nestjs/common';
import { createCrudController } from '../../common/crud/crud.controller';
import { ModulesService } from './modules.service';
import { ModuleOwnershipController } from './module-ownership.controller';
import { ModuleOwnershipService } from './module-ownership.service';
import { ModulesOverviewService } from './modules-overview.service';
import { ModuleConfigService } from './module-config.service';
import { ModuleDiagnosticsController } from './module-diagnostics.controller';
import { ModuleDiagnosticsService } from './module-diagnostics.service';

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
  // Los controladores con rutas estáticas van ANTES que el CRUD, cuyo
  // `GET /modules/:id` se tragaría `/modules/mine` y `/modules/:x/diagnostics`.
  controllers: [ModuleOwnershipController, ModuleDiagnosticsController, ModulesController],
  providers: [
    ModulesService,
    ModuleOwnershipService,
    ModulesOverviewService,
    ModuleConfigService,
    ModuleDiagnosticsService,
  ],
  exports: [ModulesService],
})
export class ModulesModule {}
