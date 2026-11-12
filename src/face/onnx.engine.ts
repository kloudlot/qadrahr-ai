import { join } from 'path';
import type * as Ort from 'onnxruntime-node';
import type Sharp from 'sharp';
import type { FaceEngine, FrameAnalysis } from './face.types';
import { FaceUnreadableFrameException } from './face.errors';
import {
  alignedCrop,
  CROP_SIZE,
  cropQuality,
  decodeDetections,
  DETECTOR_SIZE,
  DETECTOR_STRIDES,
  DetectorOutputs,
  eyeSpanOf,
  largest,
  RawImage,
  suppressOverlaps,
  unitVector,
  yawOf,
} from './geometry';

export const DETECTOR_FILE = 'face_detection_yunet_2023mar.onnx';
export const RECOGNISER_FILE = 'face_recognition_sface_2021dec.onnx';

/** A detection below this is not a face worth measuring. */
const MIN_FACE_SCORE = 0.7;
const MAX_FACE_OVERLAP = 0.3;

/**
 * YuNet finds the face and its five landmarks; SFace turns the aligned
 * face into a 128-number identity vector. Both run on the CPU through
 * ONNX Runtime, with the pre- and post-processing OpenCV's FaceDetectorYN
 * and FaceRecognizerSF do.
 *
 * The native modules are required here, not imported at the top of the
 * file: a deployment that leaves the face engine off, or a laptop the
 * runtime has no binary for, must still be able to start the service.
 */
export class OnnxFaceEngine implements FaceEngine {
  readonly model = 'yunet-2023mar+sface-2021dec';

  private constructor(
    private readonly ort: typeof Ort,
    private readonly sharp: typeof Sharp,
    private readonly detector: Ort.InferenceSession,
    private readonly recogniser: Ort.InferenceSession,
  ) {}

  static async load(modelDir: string, threads: number): Promise<OnnxFaceEngine> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ort = require('onnxruntime-node') as typeof Ort;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sharp = require('sharp') as typeof Sharp;
    const options: Ort.InferenceSession.SessionOptions = {
      intraOpNumThreads: threads,
      // Errors only: SFace's export trips a page of harmless graph warnings on every load.
      logSeverityLevel: 3,
    };
    const [detector, recogniser] = await Promise.all([
      ort.InferenceSession.create(join(modelDir, DETECTOR_FILE), options),
      ort.InferenceSession.create(join(modelDir, RECOGNISER_FILE), options),
    ]);
    return new OnnxFaceEngine(ort, sharp, detector, recogniser);
  }

  async analyse(frame: Buffer, index: number): Promise<FrameAnalysis> {
    const image = await this.decode(frame, index);
    const faces = await this.detect(image);
    const face = largest(faces);
    if (!face) return { index, width: image.width, height: image.height, faceCount: 0, face: null };

    const crop = alignedCrop(image, face.landmarks);
    const output = await this.recogniser.run({
      [this.recogniser.inputNames[0]]: new this.ort.Tensor('float32', crop, [
        1,
        3,
        CROP_SIZE,
        CROP_SIZE,
      ]),
    });
    const embedding = unitVector(output[this.recogniser.outputNames[0]].data as Float32Array);

    return {
      index,
      width: image.width,
      height: image.height,
      faceCount: faces.length,
      face: {
        ...face,
        yaw: yawOf(face.landmarks),
        eyeSpan: eyeSpanOf(face.landmarks, image.width),
        ...cropQuality(crop),
        embedding,
      },
    };
  }

  /** Raw RGB, turned the way the camera's EXIF tag says it was held. */
  private async decode(frame: Buffer, index: number): Promise<RawImage> {
    try {
      const { data, info } = await this.sharp(frame)
        .rotate()
        .removeAlpha()
        .toColourspace('srgb')
        .raw()
        .toBuffer({ resolveWithObject: true });
      if (info.channels !== 3) throw new Error(`${info.channels} channels`);
      return { data, width: info.width, height: info.height };
    } catch {
      throw new FaceUnreadableFrameException(index);
    }
  }

  private async detect(image: RawImage) {
    // Shrunk to fit, never enlarged, and anchored top-left: the padding is black.
    const scale = Math.min(DETECTOR_SIZE / image.width, DETECTOR_SIZE / image.height, 1);
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const pixels =
      scale === 1
        ? image.data
        : await this.sharp(image.data, {
            raw: { width: image.width, height: image.height, channels: 3 },
          })
            .resize(width, height, { fit: 'fill' })
            .raw()
            .toBuffer();

    // YuNet takes BGR planes, values 0–255.
    const plane = DETECTOR_SIZE * DETECTOR_SIZE;
    const input = new Float32Array(3 * plane);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const from = (y * width + x) * 3;
        const to = y * DETECTOR_SIZE + x;
        input[to] = pixels[from + 2];
        input[plane + to] = pixels[from + 1];
        input[2 * plane + to] = pixels[from];
      }
    }

    const output = await this.detector.run({
      [this.detector.inputNames[0]]: new this.ort.Tensor('float32', input, [
        1,
        3,
        DETECTOR_SIZE,
        DETECTOR_SIZE,
      ]),
    });
    const grids: DetectorOutputs = { cls: {}, obj: {}, bbox: {}, kps: {} };
    for (const stride of DETECTOR_STRIDES) {
      grids.cls[stride] = output[`cls_${stride}`].data as Float32Array;
      grids.obj[stride] = output[`obj_${stride}`].data as Float32Array;
      grids.bbox[stride] = output[`bbox_${stride}`].data as Float32Array;
      grids.kps[stride] = output[`kps_${stride}`].data as Float32Array;
    }
    return suppressOverlaps(decodeDetections(grids, scale, MIN_FACE_SCORE), MAX_FACE_OVERLAP);
  }
}
