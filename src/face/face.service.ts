import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../config/configuration';
import { FakeFaceEngine } from './fake.engine';
import { FaceBusyException, FaceDisabledException } from './face.errors';
import type { FaceEngine, FrameAnalysis } from './face.types';
import { OnnxFaceEngine } from './onnx.engine';

export interface FaceAnalysis {
  model: string;
  frames: FrameAnalysis[];
}

/**
 * The one way callers reach the face models.
 *
 * It finds, measures and embeds faces, and that is all. It keeps no
 * templates and makes no decisions: whether two embeddings are the same
 * person, and what to do about it, is the backend's call, with data only
 * the backend holds.
 *
 * Backpressure works as it does for the language model: past the limit a
 * request is refused with 503 rather than queued, because the backend
 * already retries. The limit is separate from the model's, since this work
 * is CPU here rather than a wait on someone else's API.
 */
@Injectable()
export class FaceService implements OnModuleInit {
  private readonly logger = new Logger(FaceService.name);
  private readonly settings: AppConfig['face'];
  private engine: FaceEngine | null = null;
  private inFlight = 0;

  constructor(config: ConfigService<AppConfig, true>) {
    this.settings = config.get('face', { infer: true });
  }

  /** Loaded at start, so a missing model file stops the deploy instead of the first clock-in. */
  async onModuleInit(): Promise<void> {
    const { provider, modelDir, threads, maxConcurrency } = this.settings;
    if (provider === 'off') return;
    this.engine =
      provider === 'fake' ? new FakeFaceEngine() : await OnnxFaceEngine.load(modelDir, threads);
    this.logger.log(`Face engine: ${this.engine.model}, up to ${maxConcurrency} requests at once`);
  }

  get status(): { provider: string; model: string | null; inFlight: number; capacity: number } {
    return {
      provider: this.settings.provider,
      model: this.engine?.model ?? null,
      inFlight: this.inFlight,
      capacity: this.settings.maxConcurrency,
    };
  }

  async analyse(frames: Buffer[]): Promise<FaceAnalysis> {
    if (!this.engine) throw new FaceDisabledException();
    if (this.inFlight >= this.settings.maxConcurrency) throw new FaceBusyException();

    this.inFlight += 1;
    const started = Date.now();
    try {
      // One after another: the frames of a request share its slot, so the
      // limit above really is a limit on the CPU this service will spend.
      const analysed: FrameAnalysis[] = [];
      for (let index = 0; index < frames.length; index++) {
        analysed.push(await this.engine.analyse(frames[index], index));
      }
      // Counts and timings only. Never a frame, a landmark or an embedding.
      this.logger.log(`analyse: ${frames.length} frames in ${Date.now() - started} ms`);
      return { model: this.engine.model, frames: analysed };
    } finally {
      this.inFlight -= 1;
    }
  }
}
