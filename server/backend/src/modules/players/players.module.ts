import { Module } from '@nestjs/common';
import { createCrudController } from '../../common/crud/crud.controller';
import { PlayersService } from './players.service';
import { PlayersSearchController } from './players-search.controller';
import { PlayersSearchService } from './players-search.service';

export const PlayersController = createCrudController({
  path: 'players',
  tag: 'players',
  permission: 'players',
  entity: 'player',
  serviceToken: PlayersService,
});

@Module({
  // La búsqueda va ANTES del CRUD para que `GET /players/search` no lo capture `:id`.
  controllers: [PlayersSearchController, PlayersController],
  providers: [PlayersService, PlayersSearchService],
  exports: [PlayersService],
})
export class PlayersModule {}
