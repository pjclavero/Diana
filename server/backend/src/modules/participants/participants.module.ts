import { Module } from '@nestjs/common';
import { createCrudController } from '../../common/crud/crud.controller';
import { ParticipantsService } from './participants.service';

export const ParticipantsController = createCrudController({
  path: 'participants',
  tag: 'participants',
  permission: 'participants',
  entity: 'participant',
  serviceToken: ParticipantsService,
});

@Module({
  controllers: [ParticipantsController],
  providers: [ParticipantsService],
  exports: [ParticipantsService],
})
export class ParticipantsModule {}
