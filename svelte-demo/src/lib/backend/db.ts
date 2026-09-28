// DEMO ONLY: a tiny "database" kept in localStorage so the whole demo can run on
// static hosting. In a real app these tables live in your server's database
// (Postgres, MySQL, Supabase, ...) and this file is replaced by queries.

export type User = {
	id: string;
	username: string;
	displayName: string;
	/** WebAuthn user handle (base64url), stored on the passkey itself. */
	webauthnUserId: string;
	createdAt: number;
};

export type Credential = {
	/** Credential ID (base64url) returned by the authenticator. */
	id: string;
	userId: string;
	/** COSE public key, base64url. The private key never leaves the user's device. */
	publicKey: string;
	counter: number;
	transports?: string[];
	deviceType: string;
	backedUp: boolean;
	createdAt: number;
	lastUsedAt?: number;
};

export type FaceTemplate = {
	userId: string;
	descriptors: number[][];
	thumb: string;
	updatedAt: number;
};

export type AttendanceType = 'in' | 'out';

export type AttendanceRecord = {
	id: string;
	userId: string;
	type: AttendanceType;
	/** Server time, never the client's clock. */
	time: number;
	/** Local calendar day (YYYY-MM-DD) the record belongs to. */
	day: string;
	similarity: number;
	liveness: string[];
	location: { lat: number; lng: number; accuracy: number } | null;
	/** Metres from the office, when an office location is configured. */
	distance: number | null;
};

export type Office = { lat: number; lng: number; radius: number; enforce: boolean } | null;

type Tables = {
	users: User[];
	credentials: Credential[];
	faces: FaceTemplate[];
	attendance: AttendanceRecord[];
	office: Office;
};

const KEY = 'mb-absensi.db.v1';
const empty = (): Tables => ({ users: [], credentials: [], faces: [], attendance: [], office: null });

function read(): Tables {
	try {
		return { ...empty(), ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
	} catch {
		return empty();
	}
}

/** Runs `fn` against the tables and persists any changes (like a DB transaction). */
export function tx<T>(fn: (db: Tables) => T): T {
	const db = read();
	const result = fn(db);
	localStorage.setItem(KEY, JSON.stringify(db));
	return result;
}

export const query = <T>(fn: (db: Tables) => T): T => fn(read());

export function resetDatabase() {
	localStorage.removeItem(KEY);
}

export const newId = () => crypto.randomUUID();
