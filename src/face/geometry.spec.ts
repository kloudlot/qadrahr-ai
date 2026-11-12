import type { DetectedFace, Point } from './face.types';
import {
  alignedCrop,
  CROP_LANDMARKS,
  CROP_SIZE,
  cosine,
  cropQuality,
  decodeDetections,
  DETECTOR_SIZE,
  DetectorOutputs,
  eyeSpanOf,
  largest,
  similarityTransform,
  suppressOverlaps,
  unitVector,
  yawOf,
} from './geometry';

const apply = ([a, b, tx, ty]: number[], [x, y]: Point): Point => [
  a * x - b * y + tx,
  b * x + a * y + ty,
];

const face = (x: number, y: number, size: number, score: number): DetectedFace => ({
  box: { x, y, width: size, height: size },
  score,
  landmarks: [
    [x, y],
    [x + size, y],
    [x + size / 2, y + size / 2],
    [x, y + size],
    [x + size, y + size],
  ],
});

describe('face geometry', () => {
  describe('similarityTransform', () => {
    it('recovers a known rotation, scale and shift', () => {
      const from: Point[] = [
        [10, 10],
        [50, 12],
        [30, 40],
        [14, 60],
        [48, 61],
      ];
      // Rotate 20°, scale 1.7, shift (33, -8).
      const angle = (20 * Math.PI) / 180;
      const known = [1.7 * Math.cos(angle), 1.7 * Math.sin(angle), 33, -8];
      const to = from.map((point) => apply(known, point));

      const found = similarityTransform(from, to);
      found.forEach((value, i) => expect(value).toBeCloseTo(known[i], 8));
    });

    it('refuses landmarks that all sit on one point', () => {
      const same: Point[] = [
        [5, 5],
        [5, 5],
        [5, 5],
      ];
      expect(() => similarityTransform(same, CROP_LANDMARKS.slice(0, 3))).toThrow(/coincide/);
    });
  });

  describe('alignedCrop', () => {
    it('puts the landmarks where the recogniser expects them', () => {
      // A black image with one bright dot on each landmark, the face tilted and three times the crop's size.
      const width = 600;
      const height = 600;
      const data = new Uint8Array(width * height * 3);
      const angle = (-15 * Math.PI) / 180;
      const pose = [3 * Math.cos(angle), 3 * Math.sin(angle), 120, 160];
      const landmarks = CROP_LANDMARKS.map((point) => apply(pose, point));
      for (const [x, y] of landmarks) {
        for (let dy = -3; dy <= 3; dy++) {
          for (let dx = -3; dx <= 3; dx++) {
            const at = ((Math.round(y) + dy) * width + Math.round(x) + dx) * 3;
            data[at] = data[at + 1] = data[at + 2] = 255;
          }
        }
      }

      const crop = alignedCrop({ data, width, height }, landmarks);
      expect(crop).toHaveLength(3 * CROP_SIZE * CROP_SIZE);
      for (const [x, y] of CROP_LANDMARKS) {
        expect(crop[Math.round(y) * CROP_SIZE + Math.round(x)]).toBeGreaterThan(200);
      }
      // And nothing bright in a corner, where no landmark is.
      expect(crop[2 * CROP_SIZE + 2]).toBe(0);
    });
  });

  describe('cropQuality', () => {
    const plane = CROP_SIZE * CROP_SIZE;
    const crop = (luma: (x: number, y: number) => number) => {
      const out = new Float32Array(3 * plane);
      for (let y = 0; y < CROP_SIZE; y++) {
        for (let x = 0; x < CROP_SIZE; x++) {
          out[y * CROP_SIZE + x] =
            out[plane + y * CROP_SIZE + x] =
            out[2 * plane + y * CROP_SIZE + x] =
              luma(x, y);
        }
      }
      return out;
    };

    it('reads a flat crop as having no detail, at its brightness', () => {
      const quality = cropQuality(crop(() => 90));
      expect(quality.sharpness).toBeCloseTo(0, 6);
      expect(quality.brightness).toBeCloseTo(90, 4);
    });

    it('scores hard edges above a smooth ramp', () => {
      const edges = cropQuality(crop((x, y) => (((x >> 2) + (y >> 2)) % 2 === 0 ? 220 : 30)));
      const ramp = cropQuality(crop((x) => (x / CROP_SIZE) * 255));
      expect(edges.sharpness).toBeGreaterThan(ramp.sharpness * 100);
    });
  });

  describe('suppressOverlaps', () => {
    it('keeps the stronger of two boxes on the same face, and a face elsewhere', () => {
      const kept = suppressOverlaps(
        [face(100, 100, 80, 0.8), face(104, 102, 80, 0.95), face(400, 90, 70, 0.75)],
        0.3,
      );
      expect(kept.map((f) => f.score)).toEqual([0.95, 0.75]);
    });
  });

  describe('decodeDetections', () => {
    const empty = (): DetectorOutputs => {
      const grids: DetectorOutputs = { cls: {}, obj: {}, bbox: {}, kps: {} };
      for (const stride of [8, 16, 32]) {
        const cells = (DETECTOR_SIZE / stride) ** 2;
        grids.cls[stride] = new Float32Array(cells);
        grids.obj[stride] = new Float32Array(cells);
        grids.bbox[stride] = new Float32Array(cells * 4);
        grids.kps[stride] = new Float32Array(cells * 10);
      }
      return grids;
    };

    it('finds nothing in empty grids', () => {
      expect(decodeDetections(empty(), 1, 0.7)).toEqual([]);
    });

    it('reads a cell back into source-image pixels', () => {
      const grids = empty();
      const stride = 16;
      const cells = DETECTOR_SIZE / stride;
      const row = 10;
      const col = 12;
      const i = row * cells + col;
      (grids.cls[stride] as Float32Array)[i] = 0.9;
      (grids.obj[stride] as Float32Array)[i] = 0.9;
      // Centre half a cell in, box four cells wide and five tall.
      (grids.bbox[stride] as Float32Array).set([0.5, 0.5, Math.log(4), Math.log(5)], i * 4);
      // Nose (third landmark) one cell right and two cells down from the cell's corner.
      (grids.kps[stride] as Float32Array).set([1, 2], i * 10 + 4);

      // The image was halved to fit the detector, so everything doubles on the way back.
      const [found] = decodeDetections(grids, 0.5, 0.7);
      expect(found.score).toBeCloseTo(0.9, 5);
      // The grids are 32-bit floats, so compare to a few decimals.
      expect(found.box).toEqual({
        x: expect.closeTo(((col + 0.5) * stride - 32) * 2, 3),
        y: expect.closeTo(((row + 0.5) * stride - 40) * 2, 3),
        width: expect.closeTo(4 * stride * 2, 3),
        height: expect.closeTo(5 * stride * 2, 3),
      });
      expect(found.landmarks[2]).toEqual([(col + 1) * stride * 2, (row + 2) * stride * 2]);
    });

    it('drops a cell under the score floor', () => {
      const grids = empty();
      (grids.cls[8] as Float32Array)[0] = 0.5;
      (grids.obj[8] as Float32Array)[0] = 0.5;
      expect(decodeDetections(grids, 1, 0.7)).toEqual([]);
    });
  });

  describe('pose and size', () => {
    const eyes: Point[] = [
      [100, 100],
      [200, 100],
    ];

    it('reads yaw as zero head-on, positive with the nose to the image right', () => {
      expect(yawOf([...eyes, [150, 140]])).toBe(0);
      expect(yawOf([...eyes, [180, 140]])).toBeCloseTo(0.3);
      expect(yawOf([...eyes, [120, 140]])).toBeCloseTo(-0.3);
    });

    it('measures the eye span against the image width', () => {
      expect(eyeSpanOf(eyes, 400)).toBeCloseTo(0.25);
    });

    it('picks the largest face, or none', () => {
      expect(largest([face(0, 0, 50, 0.99), face(200, 0, 120, 0.8)])?.box.width).toBe(120);
      expect(largest([])).toBeNull();
    });
  });

  describe('vectors', () => {
    it('normalises, so a dot product is the cosine', () => {
      const a = unitVector([3, 4]);
      expect(a).toEqual([0.6, 0.8]);
      expect(cosine(a, a)).toBeCloseTo(1);
      expect(cosine(a, unitVector([-4, 3]))).toBeCloseTo(0);
    });
  });
});
