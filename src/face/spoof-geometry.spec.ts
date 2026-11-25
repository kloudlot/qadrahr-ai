import { softmax, spoofCrop, spoofCropBox } from './geometry';

describe('spoofCropBox', () => {
  it('scales the box about its centre', () => {
    // A 100×100 face in the middle of a 1000×1000 image, at 2.7.
    expect(spoofCropBox({ x: 450, y: 450, width: 100, height: 100 }, 1000, 1000, 2.7)).toEqual({
      x1: 365,
      y1: 365,
      x2: 635,
      y2: 635,
    });
  });

  it('shrinks the scale rather than leave the image, and clips at the edges', () => {
    // 4.0 × 300 is taller than the image: the scale drops to 479/300, and
    // the part above the top edge is clipped off, not shifted down.
    expect(spoofCropBox({ x: 10, y: 10, width: 300, height: 300 }, 640, 480, 4.0)).toEqual({
      x1: 0,
      y1: 0,
      x2: 399,
      y2: 399,
    });
  });
});

describe('spoofCrop', () => {
  const image = (width: number, height: number, pixel: (x: number, y: number) => number[]) => {
    const data = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) data.set(pixel(x, y), (y * width + x) * 3);
    }
    return { data, width, height };
  };

  it('puts out BGR planes of raw 0–255 values', () => {
    const red = image(10, 10, () => [200, 50, 10]);
    const out = spoofCrop(red, { x1: 0, y1: 0, x2: 9, y2: 9 }, 4);
    const plane = 16;
    expect(out).toHaveLength(48);
    expect(out[0]).toBeCloseTo(10); // B
    expect(out[plane]).toBeCloseTo(50); // G
    expect(out[2 * plane]).toBeCloseTo(200); // R
  });

  it('samples bilinearly with pixel centres, as OpenCV does', () => {
    // A horizontal ramp 0,10,20,30 resized to 2 wide: OpenCV gives 5 and 25.
    const ramp = image(4, 1, (x) => [x * 10, x * 10, x * 10]);
    const out = spoofCrop(ramp, { x1: 0, y1: 0, x2: 3, y2: 0 }, 2);
    expect(out[0]).toBeCloseTo(5);
    expect(out[1]).toBeCloseTo(25);
  });

  it('reads only the region asked for', () => {
    const halves = image(20, 10, (x) => (x < 10 ? [0, 0, 0] : [255, 255, 255]));
    const right = spoofCrop(halves, { x1: 10, y1: 0, x2: 19, y2: 9 }, 5);
    expect(Math.min(...right)).toBe(255);
  });
});

describe('softmax', () => {
  it('turns logits into probabilities', () => {
    const p = softmax([1, 3, 1]);
    expect(p.reduce((a, b) => a + b)).toBeCloseTo(1);
    expect(p[1]).toBeGreaterThan(0.75);
    expect(softmax([1000, 0])[0]).toBeCloseTo(1);
  });
});
