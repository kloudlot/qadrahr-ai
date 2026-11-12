import { createHash } from 'crypto';
import type { FaceEngine, FrameAnalysis, Point } from './face.types';
import { FaceUnreadableFrameException } from './face.errors';
import { unitVector } from './geometry';

/** A frame the fake engine reads as instructions instead of pixels. */
export const FAKE_FRAME_PREFIX = 'FAKE-FACE ';

export interface FakeFrame {
  /** Who is in the frame. The same name always gives the same embedding. */
  person?: string;
  /** How many faces the frame holds. 0 is an empty frame. */
  faces?: number;
  yaw?: number;
  eyeSpan?: number;
  sharpness?: number;
  brightness?: number;
  /** 0–1: how far this capture strays from the person's usual embedding. */
  drift?: number;
}

/** Builds a frame the fake engine understands. For tests, here and in the backend. */
export function fakeFrame(frame: FakeFrame): Buffer {
  return Buffer.from(FAKE_FRAME_PREFIX + JSON.stringify(frame));
}

/** A repeatable vector for a name: the same bytes every run, unrelated across names. */
function vectorFor(seed: string): number[] {
  const values: number[] = [];
  for (let block = 0; values.length < 128; block++) {
    const digest = createHash('sha256').update(`${seed}:${block}`).digest();
    for (let i = 0; i < digest.length && values.length < 128; i++) values.push(digest[i] - 127.5);
  }
  return unitVector(values);
}

/**
 * A face engine that needs no models, for tests and for running the
 * service where the real one cannot (the ONNX runtime has no build for
 * some laptops).
 *
 * A frame made with `fakeFrame()` says who is in it and how it was held,
 * so a test can stage a match, a stranger, a turned head or an empty
 * frame. Anything else is taken as one frontal face whose identity is the
 * hash of its bytes: the same file matches itself and nothing else.
 */
export class FakeFaceEngine implements FaceEngine {
  readonly model = 'fake';

  async analyse(frame: Buffer, index: number): Promise<FrameAnalysis> {
    if (frame.length === 0) throw new FaceUnreadableFrameException(index);

    const spec = this.read(frame, index);
    const faces = spec.faces ?? 1;
    const width = 640;
    const height = 480;
    if (faces === 0) return { index, width, height, faceCount: 0, face: null };

    const person = spec.person ?? createHash('sha256').update(frame).digest('hex');
    const usual = vectorFor(person);
    const stray = vectorFor(`${person}:stray:${index}`);
    const drift = Math.min(1, Math.max(0, spec.drift ?? 0));
    const yaw = spec.yaw ?? 0;
    const eyeSpan = spec.eyeSpan ?? 0.25;
    const span = eyeSpan * width;
    const landmarks: [Point, Point, Point, Point, Point] = [
      [320 - span / 2, 200],
      [320 + span / 2, 200],
      [320 + yaw * span, 250],
      [320 - span / 3, 300],
      [320 + span / 3, 300],
    ];

    return {
      index,
      width,
      height,
      faceCount: faces,
      face: {
        box: { x: 320 - span, y: 120, width: span * 2, height: span * 2.5 },
        score: 0.95,
        landmarks,
        yaw,
        eyeSpan,
        sharpness: spec.sharpness ?? 400,
        brightness: spec.brightness ?? 130,
        embedding: unitVector(usual.map((value, i) => (1 - drift) * value + drift * stray[i])),
      },
    };
  }

  private read(frame: Buffer, index: number): FakeFrame {
    const head = frame.subarray(0, FAKE_FRAME_PREFIX.length).toString('utf8');
    if (head !== FAKE_FRAME_PREFIX) return {};
    try {
      return JSON.parse(frame.subarray(FAKE_FRAME_PREFIX.length).toString('utf8')) as FakeFrame;
    } catch {
      throw new FaceUnreadableFrameException(index);
    }
  }
}
