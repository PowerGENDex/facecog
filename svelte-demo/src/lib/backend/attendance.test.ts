import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';

// Minimal localStorage for Node (the demo backend persists to it).
const memory = new Map<string, string>();
globalThis.localStorage = {
	getItem: (k: string) => memory.get(k) ?? null,
	setItem: (k: string, v: string) => void memory.set(k, String(v)),
	removeItem: (k: string) => void memory.delete(k),
	clear: () => memory.clear(),
	key: (i: number) => [...memory.keys()][i] ?? null,
	get length() {
		return memory.size;
	}
} as Storage;

const { tx } = await import('./db.ts');
const { createSession } = await import('./session.ts');
const att = await import('./attendance.ts');

/** A random-ish 128-d unit descriptor, plus a slightly perturbed copy of it. */
function descriptor(seed: number) {
	let x = seed;
	const rand = () => ((x = (x * 16807) % 2147483647) / 2147483647) - 0.5;
	const v = Array.from({ length: 128 }, rand);
	const n = Math.hypot(...v);
	return v.map((a) => a / n);
}
const jitter = (d: number[], amount: number, seed = 7) => {
	const noise = descriptor(seed);
	return d.map((v, i) => v + noise[i] * amount);
};

const alice = descriptor(1);
const bob = descriptor(2);
const passedLiveness = { passed: true, challenges: ['left', 'mouth', 'right'] };

beforeEach(() => {
	memory.clear();
	tx((db) => db.users.push({ id: 'u1', username: 'alice', displayName: 'Alice', webauthnUserId: 'x', createdAt: 0 }));
	createSession('u1');
});

const enroll = () => att.enrollFace({ samples: [alice, jitter(alice, 0.1), jitter(alice, 0.1, 9)], thumb: '' });

test('rejects attendance before a face is enrolled', () => {
	assert.throws(
		() => att.recordAttendance({ type: 'in', samples: [alice, alice], liveness: passedLiveness, location: null }),
		/Daftarkan wajah/
	);
});

test('enrollment rejects samples from two different people', () => {
	assert.throws(() => att.enrollFace({ samples: [alice, bob, alice], thumb: '' }), /tidak konsisten/);
});

test('matching face checks in, then out; duplicates are refused', () => {
	enroll();
	const scan = { samples: [jitter(alice, 0.15), jitter(alice, 0.15, 11)], liveness: passedLiveness, location: null };
	assert.throws(() => att.recordAttendance({ type: 'out', ...scan }), /masuk dulu/);
	const rec = att.recordAttendance({ type: 'in', ...scan });
	assert.equal(rec.type, 'in');
	assert.ok(rec.similarity > 50);
	assert.throws(() => att.recordAttendance({ type: 'in', ...scan }), /sudah absen masuk/);
	assert.equal(att.recordAttendance({ type: 'out', ...scan }).type, 'out');
	assert.equal(att.todayRecords().length, 2);
});

test("someone else's face is rejected", () => {
	enroll();
	assert.throws(
		() => att.recordAttendance({ type: 'in', samples: [bob, bob], liveness: passedLiveness, location: null }),
		/tidak cocok/
	);
});

test('swapping faces between the start and end of the scan is rejected', () => {
	enroll();
	// Each sample alone is within the threshold of Alice's template (0.3 away),
	// but the two are 0.6 apart, i.e. not the same face at the start and the end.
	const n = descriptor(3);
	const a = alice.map((v, i) => v + n[i] * 0.3);
	const b = alice.map((v, i) => v - n[i] * 0.3);
	assert.throws(
		() => att.recordAttendance({ type: 'in', samples: [a, b], liveness: passedLiveness, location: null }),
		/tidak cocok/
	);
});

test('failed liveness is rejected', () => {
	enroll();
	assert.throws(
		() =>
			att.recordAttendance({
				type: 'in',
				samples: [alice, alice],
				liveness: { passed: false, challenges: [] },
				location: null
			}),
		/liveness/
	);
});

test('geofence: enforced office rejects far-away check-ins and records distance', () => {
	enroll();
	att.setOffice({ lat: -6.9175, lng: 107.6191, radius: 100, enforce: true }); // Bandung
	const scan = { samples: [alice, alice], liveness: passedLiveness };
	assert.throws(() => att.recordAttendance({ type: 'in', ...scan, location: null }), /Lokasi wajib/);
	assert.throws(
		() => att.recordAttendance({ type: 'in', ...scan, location: { lat: -6.2, lng: 106.8166, accuracy: 20 } }), // Jakarta
		/dari kantor/
	);
	const rec = att.recordAttendance({ type: 'in', ...scan, location: { lat: -6.9178, lng: 107.6193, accuracy: 15 } });
	assert.ok(rec.distance !== null && rec.distance < 100);
});

test('distanceMeters is roughly right (Bandung–Jakarta ≈ 120 km)', () => {
	const d = att.distanceMeters({ lat: -6.9175, lng: 107.6191 }, { lat: -6.2, lng: 106.8166 });
	assert.ok(d > 110000 && d < 130000, String(d));
});
