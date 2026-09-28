// Copies the face-api model weights the app needs into public/models so Vite
// serves them locally (no CDN required, works offline).
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', '@vladmandic', 'face-api', 'model');
const dest = join(root, 'public', 'models');

const MODELS = [
  'tiny_face_detector_model',
  'ssd_mobilenetv1_model',
  'face_landmark_68_model',
  'face_recognition_model',
];

if (!existsSync(src)) {
  console.error('face-api models not found. Run `npm install` first.');
  process.exit(1);
}

mkdirSync(dest, { recursive: true });
for (const name of MODELS) {
  for (const file of [`${name}-weights_manifest.json`, `${name}.bin`]) {
    copyFileSync(join(src, file), join(dest, file));
  }
}
console.log(`Copied ${MODELS.length} models to public/models`);
