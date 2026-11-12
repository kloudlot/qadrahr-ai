import { Global, Module } from '@nestjs/common';
import { FaceController } from './face.controller';
import { FaceService } from './face.service';

/** Global so health can report the engine's load beside the model's. */
@Global()
@Module({ controllers: [FaceController], providers: [FaceService], exports: [FaceService] })
export class FaceModule {}
