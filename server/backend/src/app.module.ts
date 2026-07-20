import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './common/prisma/prisma.module';
import { AppConfigModule } from './config/config.module';

import { AccuracyModule } from './modules/accuracy/accuracy.module';
import { AmmoModule } from './modules/ammo/ammo.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { JwtAuthGuard } from './modules/auth/jwt-auth.guard';
import { PermissionsGuard } from './modules/auth/permissions.guard';
import { CalibrationModule } from './modules/calibration/calibration.module';
import { ExportsModule } from './modules/exports/exports.module';
import { FirmwareModule } from './modules/firmware/firmware.module';
import { GameModesModule } from './modules/game-modes/game-modes.module';
import { GamesModule } from './modules/games/games.module';
import { HealthModule } from './modules/health/health.module';
import { HitsModule } from './modules/hits/hits.module';
import { MaintenanceModule } from './modules/maintenance/maintenance.module';
import { ModulesModule } from './modules/modules/modules.module';
import { MqttModule } from './modules/mqtt/mqtt.module';
import { ParticipantsModule } from './modules/participants/participants.module';
import { PenaltiesModule } from './modules/penalties/penalties.module';
import { PlayersModule } from './modules/players/players.module';
import { PresetsModule } from './modules/presets/presets.module';
import { RolesModule } from './modules/roles/roles.module';
import { RoundsModule } from './modules/rounds/rounds.module';
import { StatisticsModule } from './modules/statistics/statistics.module';
import { SystemsModule } from './modules/systems/systems.module';
import { TargetsModule } from './modules/targets/targets.module';
import { TeamsModule } from './modules/teams/teams.module';
import { TopologyModule } from './modules/topology/topology.module';
import { UsersModule } from './modules/users/users.module';
import { WebsocketModule } from './modules/websocket/websocket.module';

/**
 * Monolito modular (ADR-0001): un solo proceso, módulos con frontera clara.
 * NO son microservicios.
 */
@Module({
  imports: [
    AppConfigModule,
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 300 }]),
    PrismaModule,
    AuditModule,
    WebsocketModule,
    MqttModule,
    AuthModule,

    HealthModule,
    UsersModule,
    RolesModule,
    PlayersModule,
    TeamsModule,
    SystemsModule,
    ModulesModule,
    TargetsModule,
    TopologyModule,
    CalibrationModule,
    GameModesModule,
    PresetsModule,
    GamesModule,
    RoundsModule,
    ParticipantsModule,
    HitsModule,
    PenaltiesModule,
    AmmoModule,
    AccuracyModule,
    StatisticsModule,
    FirmwareModule,
    MaintenanceModule,
    ExportsModule,
  ],
  providers: [
    // Orden importante: primero autenticar, después autorizar.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
