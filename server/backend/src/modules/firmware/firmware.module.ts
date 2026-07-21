import { Module } from '@nestjs/common';
import { createCrudController } from '../../common/crud/crud.controller';
import { FirmwareDeploymentController } from './firmware-deployment.controller';
import { FirmwareDeploymentService } from './firmware-deployment.service';
import { FirmwareService } from './firmware.service';

export const FirmwareController = createCrudController({
  path: 'firmware',
  tag: 'firmware',
  permission: 'firmware',
  entity: 'firmwareVersion',
  serviceToken: FirmwareService,
});

@Module({
  controllers: [FirmwareDeploymentController, FirmwareController],
  providers: [FirmwareService, FirmwareDeploymentService],
  exports: [FirmwareService, FirmwareDeploymentService],
})
export class FirmwareModule {}
