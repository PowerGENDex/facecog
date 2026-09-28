import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LivenessTracker, faceSignal, mouthAspectRatio, randomChallenges, type Point } from './liveness.ts';

const frame = (yaw: number, mar: number, t = 0) => ({ yaw, mar, t });

/** Inner-lip landmarks 60-67 for a mouth of width 40 with the given lip gap. */
const innerLips = (gap: number): Point[] => [
	{ x: 0, y: 0 },
	{ x: 10, y: -gap / 2 },
	{ x: 20, y: -gap / 2 },
	{ x: 30, y: -gap / 2 },
	{ x: 40, y: 0 },
	{ x: 30, y: gap / 2 },
	{ x: 20, y: gap / 2 },
	{ x: 10, y: gap / 2 }
];

test('mouthAspectRatio is ~0 for closed lips and large for an open mouth', () => {
	assert.equal(mouthAspectRatio(innerLips(0)), 0);
	assert.equal(mouthAspectRatio(innerLips(16)), 0.4);
});

test('faceSignal yaw is ~0 when the nose is centred between the eyes', () => {
	const points: Point[] = Array.from({ length: 68 }, () => ({ x: 50, y: 50 }));
	points[36] = { x: 30, y: 40 };
	points[45] = { x: 70, y: 40 };
	points[30] = { x: 50, y: 60 };
	assert.equal(faceSignal(points, 0).yaw, 0);
	points[30] = { x: 60, y: 60 };
	assert.equal(faceSignal(points, 0).yaw, 0.25);
});

test('randomChallenges returns each challenge exactly once', () => {
	for (let i = 0; i < 20; i++) {
		assert.deepEqual([...randomChallenges()].sort(), ['left', 'mouth', 'right']);
	}
});

test('mouth passes only after opening and closing again', () => {
	const tracker = new LivenessTracker(['mouth']);
	for (let i = 0; i < 5; i++) tracker.calibrate(frame(0, 0.05));
	assert.equal(tracker.update(frame(0, 0.05)), false, 'resting mouth does not pass');
	assert.equal(tracker.update(frame(0, 0.12)), false, 'a small movement is not "open"');
	assert.equal(tracker.update(frame(0, 0.4)), false, 'opening alone is not enough');
	assert.equal(tracker.update(frame(0, 0.3)), false, 'still open');
	assert.equal(tracker.update(frame(0, 0.06)), true, 'closing completes the challenge');
	assert.ok(tracker.done);
});

test('a photo with an open mouth cannot pass (baseline is already open)', () => {
	const tracker = new LivenessTracker(['mouth']);
	for (let i = 0; i < 5; i++) tracker.calibrate(frame(0, 0.3));
	for (let i = 0; i < 50; i++) tracker.update(frame(0, 0.3 + (i % 3) * 0.02));
	assert.equal(tracker.done, false);
});

test('a static photo (constant signal) never passes', () => {
	const tracker = new LivenessTracker(['mouth', 'left', 'right']);
	for (let i = 0; i < 5; i++) tracker.calibrate(frame(0.02, 0.05));
	for (let i = 0; i < 100; i++) tracker.update(frame(0.02, 0.05));
	assert.equal(tracker.index, 0);
});

test('the second turn must go to the opposite side of the first', () => {
	const tracker = new LivenessTracker(['left', 'right']);
	assert.equal(tracker.update(frame(0.2, 0.3)), true);
	assert.equal(tracker.update(frame(0.25, 0.3)), false, 'same side again does not count');
	assert.equal(tracker.update(frame(0, 0.3)), false);
	assert.equal(tracker.update(frame(-0.2, 0.3)), true);
	assert.ok(tracker.done);
});

test('small head movements are ignored', () => {
	const tracker = new LivenessTracker(['left']);
	assert.equal(tracker.update(frame(0.05, 0.3)), false);
	assert.equal(tracker.update(frame(-0.1, 0.3)), false);
	assert.equal(tracker.index, 0);
});
