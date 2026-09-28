// Thin wrapper around face-api: model loading, detection and matching.
import * as faceapi from '@vladmandic/face-api';

const MODEL_URL = `${import.meta.env.BASE_URL}models`;

export async function loadModels() {
  await faceapi.tf.ready();
  await Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
    faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
    faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
    faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
  ]);
  return faceapi.tf.getBackend();
}

function detectorOptions(detector, inputSize) {
  return detector === 'ssd'
    ? new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 })
    : new faceapi.TinyFaceDetectorOptions({ inputSize, scoreThreshold: 0.5 });
}

/**
 * Rough head yaw from the 68-point landmarks: horizontal offset of the nose tip
 * from the midpoint between the outer eye corners, relative to eye distance.
 * ~0 when looking straight at the camera; the sign flips with turn direction.
 */
function estimateYaw(landmarks) {
  const p = landmarks.positions;
  const [left, right, nose] = [p[36], p[45], p[30]];
  const eyeDist = Math.hypot(right.x - left.x, right.y - left.y) || 1;
  return (nose.x - (left.x + right.x) / 2) / eyeDist;
}

/**
 * Detects every face in `input` and computes its 128-d descriptor.
 * @returns {Promise<Array<{box: {x:number,y:number,width:number,height:number}, score:number, yaw:number, descriptor: Float32Array}>>}
 */
export async function detectFaces(input, detector = 'tiny', { inputSize = 416 } = {}) {
  const results = await faceapi
    .detectAllFaces(input, detectorOptions(detector, inputSize))
    .withFaceLandmarks()
    .withFaceDescriptors();
  return results.map((r) => ({
    box: r.detection.box,
    score: r.detection.score,
    yaw: estimateYaw(r.landmarks),
    descriptor: r.descriptor,
  }));
}

export function createMatcher(people, threshold) {
  const labeled = people
    .filter((p) => p.descriptors.length > 0)
    .map((p) => new faceapi.LabeledFaceDescriptors(p.id, p.descriptors.map((d) => Float32Array.from(d))));
  return labeled.length ? new faceapi.FaceMatcher(labeled, threshold) : null;
}

/** Returns the id of the best matching person (or null) and its distance. */
export function identify(matcher, descriptor) {
  if (!matcher) return { id: null, distance: 1 };
  const best = matcher.findBestMatch(descriptor);
  return { id: best.label === 'unknown' ? null : best.label, distance: best.distance };
}

/** Crops a square, padded thumbnail of `box` out of an image/video element. */
export function cropFace(source, box, size = 128) {
  const pad = Math.max(box.width, box.height) * 0.25;
  const side = Math.max(box.width, box.height) + pad * 2;
  const sx = box.x + box.width / 2 - side / 2;
  const sy = box.y + box.height / 2 - side / 2;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  canvas.getContext('2d').drawImage(source, sx, sy, side, side, 0, 0, size, size);
  return canvas.toDataURL('image/jpeg', 0.85);
}
