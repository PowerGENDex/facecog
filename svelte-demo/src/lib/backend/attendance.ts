// Attendance + face template logic — the server half.
//
// The browser only captures face descriptors, the liveness result and GPS; every
// decision (does the face match, is it inside the office radius, is this a valid
// check-in/out) is made here. In a real app this runs on your server, so a user
// can't simply send "matched: true".
//
// Caveat of this demo: the liveness result is reported by the browser. A real
// deployment should verify liveness server-side (e.g. send short video frames to
// a certified liveness service) instead of trusting the client.
import { newId, query, tx, type AttendanceRecord, type AttendanceType, type Office } from './db.ts';
import { HttpError, requireUser } from './session.ts';

/** Max face-descriptor distance to accept a match (lower = stricter). */
export const MATCH_THRESHOLD = 0.45;
const MIN_ENROLL_SAMPLES = 3;
const DESCRIPTOR_LENGTH = 128;

export type Location = { lat: number; lng: number; accuracy: number } | null;

const euclidean = (a: number[], b: number[]) => Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0));

function assertDescriptors(samples: unknown): asserts samples is number[][] {
	const ok =
		Array.isArray(samples) &&
		samples.every((d) => Array.isArray(d) && d.length === DESCRIPTOR_LENGTH && d.every(Number.isFinite));
	if (!ok) throw new HttpError(400, 'Data wajah tidak valid.');
}

/** Distance in metres between two coordinates (haversine). */
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
	const rad = (d: number) => (d * Math.PI) / 180;
	const h =
		Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
		Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
	return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

export const localDay = (time: number) => {
	const d = new Date(time);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function myFace() {
	const user = requireUser();
	return query((db) => db.faces.find((f) => f.userId === user.id) ?? null);
}

export function enrollFace(input: { samples: number[][]; thumb: string }) {
	const user = requireUser();
	assertDescriptors(input.samples);
	if (input.samples.length < MIN_ENROLL_SAMPLES) throw new HttpError(400, 'Sampel wajah kurang.');
	// All samples must be the same person, so nobody can mix two faces into one template.
	for (const a of input.samples) {
		for (const b of input.samples) {
			if (euclidean(a, b) > MATCH_THRESHOLD + 0.1) throw new HttpError(400, 'Sampel wajah tidak konsisten. Ulangi.');
		}
	}
	const thumb = input.thumb.startsWith('data:image/') ? input.thumb : '';
	return tx((db) => {
		db.faces = db.faces.filter((f) => f.userId !== user.id);
		const face = { userId: user.id, descriptors: input.samples, thumb, updatedAt: Date.now() };
		db.faces.push(face);
		return face;
	});
}

export function todayRecords() {
	const user = requireUser();
	const day = localDay(Date.now());
	return query((db) => db.attendance.filter((r) => r.userId === user.id && r.day === day));
}

export function myHistory() {
	const user = requireUser();
	return query((db) => db.attendance.filter((r) => r.userId === user.id)).sort((a, b) => b.time - a.time);
}

export function recordAttendance(input: {
	type: AttendanceType;
	samples: number[][];
	liveness: { passed: boolean; challenges: string[] };
	location: Location;
}): AttendanceRecord {
	const user = requireUser();
	if (input.type !== 'in' && input.type !== 'out') throw new HttpError(400, 'Jenis absen tidak valid.');
	assertDescriptors(input.samples);
	if (input.samples.length < 2) throw new HttpError(400, 'Sampel wajah kurang.');
	if (!input.liveness?.passed || input.liveness.challenges?.length < 3) {
		throw new HttpError(400, 'Cek wajah asli (liveness) belum lolos.');
	}

	const template = query((db) => db.faces.find((f) => f.userId === user.id));
	if (!template) throw new HttpError(400, 'Daftarkan wajah Anda terlebih dahulu.');

	// 1:1 verification: every captured sample must match this user's own template,
	// and the samples from the start and end of the scan must match each other.
	const best = input.samples.map((s) => Math.min(...template.descriptors.map((t) => euclidean(s, t))));
	const worst = Math.max(...best);
	if (worst > MATCH_THRESHOLD || euclidean(input.samples[0], input.samples.at(-1)!) > MATCH_THRESHOLD) {
		throw new HttpError(403, 'Wajah tidak cocok dengan akun ini.');
	}

	const office = query((db) => db.office);
	const location = input.location;
	const distance = office && location ? Math.round(distanceMeters(office, location)) : null;
	if (office?.enforce) {
		if (!location) throw new HttpError(403, 'Lokasi wajib aktif untuk absen.');
		// Give the benefit of the GPS accuracy radius, capped so a vague fix can't cover everything.
		if (distance! > office.radius + Math.min(location.accuracy, 100)) {
			throw new HttpError(403, `Anda berada ${distance} m dari kantor (maks. ${office.radius} m).`);
		}
	}

	const time = Date.now();
	const day = localDay(time);
	return tx((db) => {
		const today = db.attendance.filter((r) => r.userId === user.id && r.day === day);
		if (input.type === 'in' && today.some((r) => r.type === 'in')) throw new HttpError(409, 'Anda sudah absen masuk hari ini.');
		if (input.type === 'out' && !today.some((r) => r.type === 'in')) throw new HttpError(409, 'Absen masuk dulu sebelum absen pulang.');
		if (input.type === 'out' && today.some((r) => r.type === 'out')) throw new HttpError(409, 'Anda sudah absen pulang hari ini.');

		const record: AttendanceRecord = {
			id: newId(),
			userId: user.id,
			type: input.type,
			time,
			day,
			similarity: Math.round(Math.max(0, 1 - worst) * 100),
			liveness: input.liveness.challenges.map(String).slice(0, 5),
			location,
			distance
		};
		db.attendance.push(record);
		return record;
	});
}

/** All records with user names, newest first (the "admin" recap). */
export function allRecords() {
	requireUser();
	return query((db) =>
		db.attendance
			.map((r) => ({ ...r, name: db.users.find((u) => u.id === r.userId)?.displayName ?? '(dihapus)' }))
			.sort((a, b) => b.time - a.time)
	);
}

export function getOffice(): Office {
	requireUser();
	return query((db) => db.office);
}

export function setOffice(office: Office) {
	requireUser();
	if (office && !(Number.isFinite(office.lat) && Number.isFinite(office.lng) && office.radius >= 10 && office.radius <= 5000)) {
		throw new HttpError(400, 'Lokasi atau radius kantor tidak valid (radius 10–5000 m).');
	}
	tx((db) => (db.office = office));
}
