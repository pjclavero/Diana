import { Module } from '@nestjs/common';
import { createCrudController } from '../../common/crud/crud.controller';
import { GameModesService } from './game-modes.service';

export const GameModesController = createCrudController({
  path: 'game-modes',
  tag: 'game-modes',
  permission: 'game-modes',
  entity: 'gameMode',
  serviceToken: GameModesService,
});

@Module({
  controllers: [GameModesController],
  providers: [GameModesService],
  exports: [GameModesService],
})
export class GameModesModule {}
