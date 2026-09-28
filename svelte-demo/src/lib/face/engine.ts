// Browser-only wrapper around face-api. The library is imported lazily so the
// SvelteKit build (which also evaluates modules on the server for prerendering)
// never loads TensorFlow.js outside the browser.
import { base } from '$app/paths';
import { faceSignal, type FaceSignal } from './liveness.ts';

type FaceApi = typeof import('@vladmandic/face-api');

export type DetectedFace = {
	box: { x: number; y: number; width: number; height: number };
	descriptor: Float32Array;
	signal: FaceSignal;
};

let api: Promise<FaceApi> | null = null;

/** Loads face-api and the model weights once; later calls reuse the same promise. */
export function loadFaceEngine(): Promise<FaceApi> {
	api ??= (async () => {
		const faceapi = await import('@vladmandic/face-api');
		// face-api's bundled typings omit tf.ready(), which waits for the WebGL/CPU backend.
		await (faceapi.tf as unknown as { ready(): Promise<void> }).ready();
		const url = `${base}/models`;
		await Promise.all([
			faceapi.nets.tinyFaceDetector.loadFromUri(url),
			faceapi.nets.ssdMobilenetv1.loadFromUri(url),
			faceapi.nets.faceLandmark68Net.loadFromUri(url),
			faceapi.nets.faceRecognitionNet.loadFromUri(url)
		]);
		return faceapi;
	})();
	api.catch(() => (api = null)); // allow a retry after a failed load
	return api;
}

/**
 * Detects faces with the fast Tiny detector, falling back to the more accurate (slower)
 * SSD MobileNet when Tiny finds nothing — Tiny misses some faces, e.g. close-ups.
 */
export async function detectFaces(input: HTMLVideoElement | HTMLImageElement): Promise<DetectedFace[]> {
	const faceapi = await loadFaceEngine();
	const t = performance.now();
	const detect = (options: Parameters<FaceApi['detectAllFaces']>[1]) =>
		faceapi.detectAllFaces(input, options).withFaceLandmarks().withFaceDescriptors();
	let results = await detect(new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 }));
	if (!results.length) results = await detect(new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }));
	return results.map((r) => ({
		box: r.detection.box,
		descriptor: r.descriptor,
		signal: faceSignal(r.landmarks.positions, t)
	}));
}

/** Crops a square, padded JPEG thumbnail of `box` from a video/image element. */
export function cropFace(source: HTMLVideoElement | HTMLImageElement, box: DetectedFace['box'], size = 128): string {
	const side = Math.max(box.width, box.height) * 1.5;
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = size;
	canvas
		.getContext('2d')!
		.drawImage(source, box.x + box.width / 2 - side / 2, box.y + box.height / 2 - side / 2, side, side, 0, 0, size, size);
	return canvas.toDataURL('image/jpeg', 0.85);
}
