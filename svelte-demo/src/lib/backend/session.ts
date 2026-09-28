// DEMO ONLY: the session is a user id in localStorage. A real server would issue a
// random session token in an HttpOnly, Secure cookie and look it up on each request.
import { query, type User } from './db.ts';

const KEY = 'mb-absensi.session.v1';

export function createSession(userId: string) {
	localStorage.setItem(KEY, userId);
}

export function destroySession() {
	localStorage.removeItem(KEY);
}

export function sessionUser(): User | null {
	const id = localStorage.getItem(KEY);
	return id ? (query((db) => db.users.find((u) => u.id === id)) ?? null) : null;
}

export class HttpError extends Error {
	status: number;
	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

/** Like a server's auth middleware: returns the logged-in user or throws 401. */
export function requireUser(): User {
	const user = sessionUser();
	if (!user) throw new HttpError(401, 'Sesi berakhir. Silakan masuk lagi.');
	return user;
}
