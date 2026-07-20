import { Module } from '@nestjs/common';
import { createCrudController } from '../../common/crud/crud.controller';
import { PlayersService } from './players.service';

export const PlayersController = createCrudController({
  path: 'players',
  tag: 'players',
  permission: 'players',
  entity: 'player',
  serviceToken: PlayersService,
});

@Module({
  controllers: [PlayersController],
  providers: [PlayersService],
  exports: [PlayersService],
})
export class PlayersModule {}
