import { Module } from '@nestjs/common';
import { createCrudController } from '../../common/crud/crud.controller';
import { CalibrationService } from './calibration.service';

export const CalibrationController = createCrudController({
  path: 'calibration',
  tag: 'calibration',
  permission: 'calibration',
  entity: 'sensorCalibration',
  serviceToken: CalibrationService,
});

@Module({
  controllers: [CalibrationController],
  providers: [CalibrationService],
  exports: [CalibrationService],
})
export class CalibrationModule {}
