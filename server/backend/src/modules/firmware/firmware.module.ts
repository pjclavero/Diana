import { Module } from '@nestjs/common';
import { createCrudController } from '../../common/crud/crud.controller';
import { FirmwareBinaryController } from './firmware-binary.controller';
import { FirmwareBinaryService } from './firmware-binary.service';
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
  // Binario y despliegue ANTES del CRUD: sus rutas (`upload`, `:id/binary`,
  // `:id/link`…) deben resolverse antes que el `:id` genérico del CRUD.
  controllers: [FirmwareBinaryController, FirmwareDeploymentController, FirmwareController],
  providers: [FirmwareService, FirmwareDeploymentService, FirmwareBinaryService],
  exports: [FirmwareService, FirmwareDeploymentService, FirmwareBinaryService],
})
export class FirmwareModule {}
