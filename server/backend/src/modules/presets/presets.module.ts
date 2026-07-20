import { Module } from '@nestjs/common';
import { createCrudController } from '../../common/crud/crud.controller';
import { PresetsService } from './presets.service';

export const PresetsController = createCrudController({
  path: 'presets',
  tag: 'presets',
  permission: 'presets',
  entity: 'gamePreset',
  serviceToken: PresetsService,
});

@Module({
  controllers: [PresetsController],
  providers: [PresetsService],
  exports: [PresetsService],
})
export class PresetsModule {}
