#!/usr/bin/env node
/**
 * Fetches the face models into ./models (or FACE_MODEL_DIR), and
 * refuses any file whose SHA-256 is not the one pinned here.
 *
 *   npm run face:models
 *
 * They are not committed: 38 MB of binary does not belong in git. The
 * Docker build runs this, so an image always carries exactly these files.
 *
 * - YuNet (face detection), MIT, and SFace (face recognition), Apache-2.0,
 *   from the OpenCV Model Zoo.
 * - MiniFASNet V2 and V1SE (presentation-attack detection), Apache-2.0,
 *   trained by Minivision (Silent-Face-Anti-Spoofing) and exported to ONNX
 *   by yakhyo/face-anti-spoofing. The hashes are the ones the uniface
 *   library pins for the same files.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const SOURCE = 'https://github.com/opencv/opencv_zoo/raw/main/models';
const MODELS = [
  {
    file: 'face_detection_yunet_2023mar.onnx',
    url: `${SOURCE}/face_detection_yunet/face_detection_yunet_2023mar.onnx`,
    sha256: '8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4',
  },
  {
    file: 'face_recognition_sface_2021dec.onnx',
    url: `${SOURCE}/face_recognition_sface/face_recognition_sface_2021dec.onnx`,
    sha256: '0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79',
  },
  {
    file: 'MiniFASNetV2.onnx',
    url: 'https://github.com/yakhyo/face-anti-spoofing/releases/download/weights/MiniFASNetV2.onnx',
    sha256: 'b32929adc2d9c34b9486f8c4c7bc97c1b69bc0ea9befefc380e4faae4e463907',
  },
  {
    file: 'MiniFASNetV1SE.onnx',
    url: 'https://github.com/yakhyo/face-anti-spoofing/releases/download/weights/MiniFASNetV1SE.onnx',
    sha256: 'ebab7f90c7833fbccd46d3a555410e78d969db5438e169b6524be444862b3676',
  },
];

const dir = process.env.FACE_MODEL_DIR || join(process.cwd(), 'models');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

await mkdir(dir, { recursive: true });
for (const model of MODELS) {
  const path = join(dir, model.file);
  const existing = await readFile(path).catch(() => null);
  if (existing && digest(existing) === model.sha256) {
    console.log(`ok       ${model.file}`);
    continue;
  }

  const response = await fetch(model.url);
  if (!response.ok) throw new Error(`${model.file}: ${response.status} from ${model.url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const got = digest(bytes);
  if (got !== model.sha256) {
    throw new Error(`${model.file}: SHA-256 ${got} is not the pinned ${model.sha256}. Not saved.`);
  }
  await writeFile(path, bytes);
  console.log(`fetched  ${model.file} (${(bytes.length / 1e6).toFixed(1)} MB)`);
}
