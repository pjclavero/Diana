import { Module } from '@nestjs/common';
import { createCrudController } from '../../common/crud/crud.controller';
import { TeamsService } from './teams.service';

export const TeamsController = createCrudController({
  path: 'teams',
  tag: 'teams',
  permission: 'teams',
  entity: 'team',
  serviceToken: TeamsService,
});

@Module({
  controllers: [TeamsController],
  providers: [TeamsService],
  exports: [TeamsService],
})
export class TeamsModule {}
