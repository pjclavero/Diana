import { Module } from '@nestjs/common';
import { createCrudController } from '../../common/crud/crud.controller';
import { FirmwareService } from './firmware.service';

export const FirmwareController = createCrudController({
  path: 'firmware',
  tag: 'firmware',
  permission: 'firmware',
  entity: 'firmwareVersion',
  serviceToken: FirmwareService,
});

@Module({
  controllers: [FirmwareController],
  providers: [FirmwareService],
  exports: [FirmwareService],
})
export class FirmwareModule {}
