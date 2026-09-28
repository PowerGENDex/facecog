// What the UI calls. In the demo each function invokes the simulated backend
// directly; in a real app each one becomes a fetch() to your API route, e.g.
//
//   export const loginOptions = () => post('/api/passkey/login/options');
//
// Payloads are round-tripped through JSON so the demo behaves like a real network
// boundary (no shared object references, typed arrays become plain arrays).
import * as attendance from './backend/attendance.ts';
import * as passkey from './backend/passkey.ts';
import { resetDatabase } from './backend/db.ts';
import { destroySession, HttpError, sessionUser } from './backend/session.ts';

export class ApiError extends Error {
	status: number;
	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

const clone = <T>(value: T): T => (value === undefined ? value : JSON.parse(JSON.stringify(value)));

async function call<A extends unknown[], R>(fn: (...args: A) => R | Promise<R>, ...args: A): Promise<Awaited<R>> {
	try {
		return clone(await fn(...(args.map(clone) as A)));
	} catch (err) {
		if (err instanceof HttpError) throw new ApiError(err.status, err.message);
		throw err;
	}
}

export const api = {
	me: () => call(sessionUser),
	logout: () => call(destroySession),

	registrationOptions: (input: { username: string; displayName: string }) => call(passkey.registrationOptions, input),
	verifyRegistration: (response: Parameters<typeof passkey.verifyRegistration>[0]) =>
		call(passkey.verifyRegistration, response),
	loginOptions: () => call(passkey.loginOptions),
	verifyLogin: (response: Parameters<typeof passkey.verifyLogin>[0]) => call(passkey.verifyLogin, response),
	myPasskeys: async () => {
		const user = sessionUser();
		return user ? call(passkey.listPasskeys, user.id) : [];
	},

	myFace: () => call(attendance.myFace),
	enrollFace: (input: Parameters<typeof attendance.enrollFace>[0]) => call(attendance.enrollFace, input),
	todayRecords: () => call(attendance.todayRecords),
	myHistory: () => call(attendance.myHistory),
	recordAttendance: (input: Parameters<typeof attendance.recordAttendance>[0]) =>
		call(attendance.recordAttendance, input),
	allRecords: () => call(attendance.allRecords),
	getOffice: () => call(attendance.getOffice),
	setOffice: (office: Parameters<typeof attendance.setOffice>[0]) => call(attendance.setOffice, office),

	/** Demo only: wipes every table on this device. */
	resetDemo: () =>
		call(() => {
			resetDatabase();
			destroySession();
		})
};
