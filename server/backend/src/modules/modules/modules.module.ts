import { Global, Module } from '@nestjs/common';
import { createCrudController } from '../../common/crud/crud.controller';
import { ModulesService } from './modules.service';
import { ModuleOwnershipController } from './module-ownership.controller';
import { ModuleOwnershipService } from './module-ownership.service';
import { ModulesOverviewService } from './modules-overview.service';
import { ModuleConfigService } from './module-config.service';
import { ModuleDiagnosticsController } from './module-diagnostics.controller';
import { ModuleDiagnosticsService } from './module-diagnostics.service';
import { GamesModule } from '../games/games.module';
import { CreateModuleDto, UpdateModuleDto } from './dto/module.dto';
import { ModuleConfigReportedService } from './module-config-reported.service';
import { CONFIG_REPORTED_SINK } from './module-config.ports';

export const ModulesController = createCrudController({
  path: 'modules',
  tag: 'modules',
  permission: 'modules',
  entity: 'module',
  serviceToken: ModulesService,
  // T1 · el cuerpo deja de ser un objeto libre. Sin estos DTO el
  // `ValidationPipe` global no valida nada (el metatipo del parámetro en el
  // controlador fabricado es `Object`) y la única defensa era la lista blanca
  // del servicio, que descarta en SILENCIO.
  createDto: CreateModuleDto,
  updateDto: UpdateModuleDto,
});

// @Global por el MISMO motivo que ProvisioningModule: `IngestService` vive en
// MqttModule e inyecta CONFIG_REPORTED_SINK, que se provee aquí. MqttModule no
// puede importar ModulesModule sin arriesgar un ciclo (ModulesModule importa
// GamesModule), y un puerto opcional que no resuelve no falla al arrancar: se
// queda en `undefined` y la ingesta descarta el mensaje en silencio, que es
// justo el fallo invisible que este puerto viene a cerrar.
@Global()
@Module({
  // `GamesModule` la necesita `ModuleDiagnosticsService` para preguntar si el
  // panel del módulo está ocupado por una partida activa (guardarraíl de
  // `game_in_progress`, ver el propio servicio). `GamesModule` no importa
  // `ModulesModule`, así que no hay ciclo.
  imports: [GamesModule],
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
    ModuleConfigReportedService,
    // El puerto se ata a la implementación AQUÍ y se exporta, igual que hace
    // ProvisioningModule con PROVISION_STATE_SINK: la ingesta lo inyecta como
    // opcional y no conoce ni a Prisma ni a este servicio.
    { provide: CONFIG_REPORTED_SINK, useExisting: ModuleConfigReportedService },
  ],
  exports: [ModulesService, ModuleConfigReportedService, CONFIG_REPORTED_SINK],
})
export class ModulesModule {}
