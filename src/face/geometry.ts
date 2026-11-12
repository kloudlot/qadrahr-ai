import type { DetectedFace, Point } from './face.types';

/** YuNet's fixed input side, and the strides of its three output scales. */
export const DETECTOR_SIZE = 640;
export const DETECTOR_STRIDES = [8, 16, 32] as const;

/** The side of SFace's aligned input crop. */
export const CROP_SIZE = 112;

/**
 * Where the five landmarks must land in the 112×112 crop SFace was trained
 * on (the values OpenCV's FaceRecognizerSF aligns to).
 */
export const CROP_LANDMARKS: Point[] = [
  [38.2946, 51.6963],
  [73.5318, 51.5014],
  [56.0252, 71.7366],
  [41.5493, 92.3655],
  [70.7299, 92.2041],
];

/** `x' = a·x − b·y + tx`, `y' = b·x + a·y + ty`: rotation, uniform scale and shift. */
export type Similarity = [a: number, b: number, tx: number, ty: number];

/** The least-squares similarity transform taking `from` onto `to`. */
export function similarityTransform(from: Point[], to: Point[]): Similarity {
  const n = from.length;
  let fx = 0;
  let fy = 0;
  let tx = 0;
  let ty = 0;
  for (let i = 0; i < n; i++) {
    fx += from[i][0];
    fy += from[i][1];
    tx += to[i][0];
    ty += to[i][1];
  }
  fx /= n;
  fy /= n;
  tx /= n;
  ty /= n;

  let dot = 0;
  let cross = 0;
  let spread = 0;
  for (let i = 0; i < n; i++) {
    const px = from[i][0] - fx;
    const py = from[i][1] - fy;
    const qx = to[i][0] - tx;
    const qy = to[i][1] - ty;
    dot += px * qx + py * qy;
    cross += px * qy - py * qx;
    spread += px * px + py * py;
  }
  if (spread === 0) throw new Error('Landmarks coincide; no transform exists');
  const a = dot / spread;
  const b = cross / spread;
  return [a, b, tx - (a * fx - b * fy), ty - (b * fx + a * fy)];
}

export interface RawImage {
  /** Interleaved RGB, 8 bits a channel. */
  data: Uint8Array;
  width: number;
  height: number;
}

/**
 * The face warped upright into a 112×112 crop: three planes (R, G, B),
 * values 0–255, sampled bilinearly. Outside the image is black.
 */
export function alignedCrop(image: RawImage, landmarks: Point[]): Float32Array {
  const [a, b, tx, ty] = similarityTransform(landmarks, CROP_LANDMARKS);
  const scale = a * a + b * b;
  const ia = a / scale;
  const ib = -b / scale;
  const plane = CROP_SIZE * CROP_SIZE;
  const out = new Float32Array(3 * plane);
  const { data, width, height } = image;

  for (let y = 0; y < CROP_SIZE; y++) {
    for (let x = 0; x < CROP_SIZE; x++) {
      const ux = x - tx;
      const uy = y - ty;
      const sx = ia * ux - ib * uy;
      const sy = ib * ux + ia * uy;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const fx = sx - x0;
      const fy = sy - y0;
      for (let channel = 0; channel < 3; channel++) {
        let value = 0;
        for (let corner = 0; corner < 4; corner++) {
          const px = x0 + (corner & 1);
          const py = y0 + (corner >> 1);
          if (px < 0 || py < 0 || px >= width || py >= height) continue;
          const weight = (corner & 1 ? fx : 1 - fx) * (corner >> 1 ? fy : 1 - fy);
          value += weight * data[(py * width + px) * 3 + channel];
        }
        out[channel * plane + y * CROP_SIZE + x] = value;
      }
    }
  }
  return out;
}

/** Focus and exposure of an aligned crop: Laplacian variance and mean luma. */
export function cropQuality(crop: Float32Array): { sharpness: number; brightness: number } {
  const plane = CROP_SIZE * CROP_SIZE;
  const luma = new Float32Array(plane);
  let total = 0;
  for (let i = 0; i < plane; i++) {
    luma[i] = 0.299 * crop[i] + 0.587 * crop[plane + i] + 0.114 * crop[2 * plane + i];
    total += luma[i];
  }

  let sum = 0;
  let sumSquares = 0;
  let count = 0;
  for (let y = 1; y < CROP_SIZE - 1; y++) {
    for (let x = 1; x < CROP_SIZE - 1; x++) {
      const i = y * CROP_SIZE + x;
      const laplacian =
        luma[i - CROP_SIZE] + luma[i + CROP_SIZE] + luma[i - 1] + luma[i + 1] - 4 * luma[i];
      sum += laplacian;
      sumSquares += laplacian * laplacian;
      count += 1;
    }
  }
  const mean = sum / count;
  return { sharpness: sumSquares / count - mean * mean, brightness: total / plane };
}

function overlap(a: DetectedFace['box'], b: DetectedFace['box']): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  if (width <= 0 || height <= 0) return 0;
  const intersection = width * height;
  return intersection / (a.width * a.height + b.width * b.height - intersection);
}

/** Keeps the best-scoring box of every overlapping group. */
export function suppressOverlaps(faces: DetectedFace[], maxOverlap: number): DetectedFace[] {
  const kept: DetectedFace[] = [];
  for (const face of [...faces].sort((a, b) => b.score - a.score)) {
    if (!kept.some((other) => overlap(other.box, face.box) > maxOverlap)) kept.push(face);
  }
  return kept;
}

export interface DetectorOutputs {
  /** Per stride: class score, objectness, box (4 per cell) and landmarks (10 per cell). */
  cls: Record<number, ArrayLike<number>>;
  obj: Record<number, ArrayLike<number>>;
  bbox: Record<number, ArrayLike<number>>;
  kps: Record<number, ArrayLike<number>>;
}

const unit = (value: number) => Math.min(1, Math.max(0, value));

/**
 * Turns YuNet's raw grids into faces in source-image pixels.
 *
 * `scale` is how much the image was shrunk to fit the detector's input, so
 * dividing by it puts every coordinate back in the original image.
 */
export function decodeDetections(
  outputs: DetectorOutputs,
  scale: number,
  minScore: number,
): DetectedFace[] {
  const faces: DetectedFace[] = [];
  for (const stride of DETECTOR_STRIDES) {
    const cells = DETECTOR_SIZE / stride;
    const cls = outputs.cls[stride];
    const obj = outputs.obj[stride];
    const bbox = outputs.bbox[stride];
    const kps = outputs.kps[stride];
    for (let row = 0; row < cells; row++) {
      for (let col = 0; col < cells; col++) {
        const i = row * cells + col;
        const score = Math.sqrt(unit(cls[i]) * unit(obj[i]));
        if (score < minScore) continue;

        const centreX = (col + bbox[i * 4]) * stride;
        const centreY = (row + bbox[i * 4 + 1]) * stride;
        const width = Math.exp(bbox[i * 4 + 2]) * stride;
        const height = Math.exp(bbox[i * 4 + 3]) * stride;
        const landmarks = [0, 1, 2, 3, 4].map((n): Point => [
          ((kps[i * 10 + 2 * n] + col) * stride) / scale,
          ((kps[i * 10 + 2 * n + 1] + row) * stride) / scale,
        ]) as DetectedFace['landmarks'];

        faces.push({
          box: {
            x: (centreX - width / 2) / scale,
            y: (centreY - height / 2) / scale,
            width: width / scale,
            height: height / scale,
          },
          score,
          landmarks,
        });
      }
    }
  }
  return faces;
}

/** See `AnalysedFace.yaw`. */
export function yawOf(landmarks: Point[]): number {
  const [left, right, nose] = landmarks;
  const span = Math.abs(right[0] - left[0]) || 1;
  return (nose[0] - (left[0] + right[0]) / 2) / span;
}

/** See `AnalysedFace.eyeSpan`. */
export function eyeSpanOf(landmarks: Point[], imageWidth: number): number {
  const [left, right] = landmarks;
  return Math.hypot(right[0] - left[0], right[1] - left[1]) / imageWidth;
}

export function largest(faces: DetectedFace[]): DetectedFace | null {
  let best: DetectedFace | null = null;
  for (const face of faces) {
    if (!best || face.box.width * face.box.height > best.box.width * best.box.height) best = face;
  }
  return best;
}

export function unitVector(values: ArrayLike<number>): number[] {
  let norm = 0;
  for (let i = 0; i < values.length; i++) norm += values[i] * values[i];
  norm = Math.sqrt(norm) || 1;
  return Array.from(values, (value) => value / norm);
}

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}
