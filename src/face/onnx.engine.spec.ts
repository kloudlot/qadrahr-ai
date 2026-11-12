/**
 * @jest-environment ../test/native-arrays.environment.js
 */
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { cosine } from './geometry';
import { DETECTOR_FILE, OnnxFaceEngine, RECOGNISER_FILE } from './onnx.engine';

/**
 * The real models, on real photographs.
 *
 * Skipped unless FACE_FIXTURES names a folder of photographs, one folder a
 * person (`<dir>/<person>/*.jpg`, at least two people with two photos
 * each), and the models have been fetched. Photographs of people are not
 * committed to this repository, and ONNX Runtime has no build for some
 * development machines, so this runs where both are true: in the Linux
 * image, against a set you are entitled to use.
 *
 *   npm run face:models
 *   FACE_FIXTURES=/path/to/people npm test -- onnx.engine
 */
const fixtures = process.env.FACE_FIXTURES;
const modelDir = process.env.FACE_MODEL_DIR || join(process.cwd(), 'models');
const ready =
  !!fixtures &&
  existsSync(fixtures) &&
  existsSync(join(modelDir, DETECTOR_FILE)) &&
  existsSync(join(modelDir, RECOGNISER_FILE));

(ready ? describe : describe.skip)('OnnxFaceEngine (real models)', () => {
  let engine: OnnxFaceEngine;
  let people: { name: string; photos: Buffer[] }[];

  beforeAll(async () => {
    engine = await OnnxFaceEngine.load(modelDir, 2);
    people = readdirSync(fixtures as string, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({
        name: entry.name,
        photos: readdirSync(join(fixtures as string, entry.name))
          .filter((file) => /\.(jpe?g|png|webp)$/i.test(file))
          .slice(0, 3)
          .map((file) => readFileSync(join(fixtures as string, entry.name, file))),
      }))
      .filter((person) => person.photos.length >= 2)
      .slice(0, 6);
    expect(people.length).toBeGreaterThanOrEqual(2);
  }, 60_000);

  it('finds a face in every photograph and embeds it as a unit vector', async () => {
    for (const person of people) {
      for (const [index, photo] of person.photos.entries()) {
        const frame = await engine.analyse(photo, index);
        expect(frame.faceCount).toBeGreaterThanOrEqual(1);
        expect(frame.face?.embedding).toHaveLength(128);
        expect(cosine(frame.face!.embedding, frame.face!.embedding)).toBeCloseTo(1, 4);
        expect(frame.face!.landmarks).toHaveLength(5);
        // The left eye is left of the right eye, and the nose is below both.
        const [left, right, nose] = frame.face!.landmarks;
        expect(left[0]).toBeLessThan(right[0]);
        expect(nose[1]).toBeGreaterThan(Math.min(left[1], right[1]));
      }
    }
  }, 120_000);

  it('scores the same person above strangers', async () => {
    const embedded = await Promise.all(
      people.map(async (person) => ({
        name: person.name,
        vectors: await Promise.all(
          person.photos.map(async (photo, i) => (await engine.analyse(photo, i)).face!.embedding),
        ),
      })),
    );

    const same: number[] = [];
    const different: number[] = [];
    for (const [i, a] of embedded.entries()) {
      for (let x = 0; x < a.vectors.length; x++) {
        for (let y = x + 1; y < a.vectors.length; y++)
          same.push(cosine(a.vectors[x], a.vectors[y]));
      }
      for (const b of embedded.slice(i + 1)) {
        for (const va of a.vectors) for (const vb of b.vectors) different.push(cosine(va, vb));
      }
    }
    const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;
    expect(mean(same)).toBeGreaterThan(0.5);
    expect(mean(different)).toBeLessThan(0.2);
    expect(Math.min(...same)).toBeGreaterThan(Math.max(...different));
  }, 120_000);

  it('answers 400 for bytes that are not an image', async () => {
    await expect(engine.analyse(Buffer.from('not an image'), 3)).rejects.toMatchObject({
      status: 400,
      response: { error: 'unreadable_frame', frame: 3 },
    });
  });

  it('reports no face in a blank image', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sharp = require('sharp');
    const blank = await sharp({
      create: { width: 320, height: 240, channels: 3, background: { r: 120, g: 120, b: 120 } },
    })
      .jpeg()
      .toBuffer();
    expect(await engine.analyse(blank, 0)).toMatchObject({
      width: 320,
      height: 240,
      faceCount: 0,
      face: null,
    });
  });
});
