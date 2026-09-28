// Passkey (WebAuthn) registration and login — the server half.
//
// This is the code you would put behind API routes in your real SvelteKit app
// (e.g. src/routes/api/passkey/*/+server.ts). It only runs in the browser here
// because the demo is hosted on GitHub Pages, which has no server. The flow and the
// @simplewebauthn/server calls are exactly the same on a real server.
import {
	generateAuthenticationOptions,
	generateRegistrationOptions,
	verifyAuthenticationResponse,
	verifyRegistrationResponse,
	type AuthenticationResponseJSON,
	type RegistrationResponseJSON
} from '@simplewebauthn/server';
import { newId, query, tx, type User } from './db.ts';
import { createSession, HttpError } from './session.ts';

const RP_NAME = 'Maca Beungeut Absensi';

// On a real server these are fixed config values, e.g. rpID 'absen.example.com'
// and origin 'https://absen.example.com'. Never take them from the request.
const rpID = () => location.hostname;
const origin = () => location.origin;

// Pending challenges. A real server keeps these in the user's session (server side)
// and deletes them after one use, so a signed response cannot be replayed.
let pendingRegistration: { challenge: string; user: User } | null = null;
let pendingLoginChallenge: string | null = null;

const toBase64Url = (bytes: Uint8Array) =>
	btoa(String.fromCharCode(...bytes))
		.replaceAll('+', '-')
		.replaceAll('/', '_')
		.replace(/=+$/, '');
const fromBase64Url = (s: string) =>
	Uint8Array.from(atob(s.replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0));

const USERNAME = /^[a-z0-9._]{3,30}$/;

/** Step 1 of sign-up: returns options for navigator.credentials.create(). */
export async function registrationOptions(input: { username: string; displayName: string }) {
	const username = input.username.trim().toLowerCase();
	const displayName = input.displayName.trim();
	if (!USERNAME.test(username)) {
		throw new HttpError(400, 'Username 3–30 karakter: huruf kecil, angka, titik atau garis bawah.');
	}
	if (!displayName) throw new HttpError(400, 'Nama lengkap wajib diisi.');
	if (query((db) => db.users.some((u) => u.username === username))) {
		throw new HttpError(409, `Username "${username}" sudah dipakai.`);
	}

	const webauthnUserId = crypto.getRandomValues(new Uint8Array(32));
	const options = await generateRegistrationOptions({
		rpName: RP_NAME,
		rpID: rpID(),
		userName: username,
		userDisplayName: displayName,
		userID: webauthnUserId,
		attestationType: 'none',
		authenticatorSelection: {
			// Discoverable credential: lets people log in without typing a username.
			residentKey: 'required',
			// Require the device's biometric/PIN check, not just a tap.
			userVerification: 'required'
		},
		// Hint browsers to offer this device's Face ID / fingerprint first.
		preferredAuthenticatorType: 'localDevice'
	});

	pendingRegistration = {
		challenge: options.challenge,
		user: {
			id: newId(),
			username,
			displayName,
			webauthnUserId: toBase64Url(webauthnUserId),
			createdAt: Date.now()
		}
	};
	return options;
}

/** Step 2 of sign-up: verifies the new passkey, creates the user and logs them in. */
export async function verifyRegistration(response: RegistrationResponseJSON) {
	const pending = pendingRegistration;
	pendingRegistration = null;
	if (!pending) throw new HttpError(400, 'Pendaftaran kedaluwarsa. Coba lagi.');

	const { verified, registrationInfo } = await verifyRegistrationResponse({
		response,
		expectedChallenge: pending.challenge,
		expectedOrigin: origin(),
		expectedRPID: rpID(),
		requireUserVerification: true
	});
	if (!verified) throw new HttpError(400, 'Passkey tidak valid.');

	const { credential, credentialDeviceType, credentialBackedUp } = registrationInfo;
	tx((db) => {
		if (db.users.some((u) => u.username === pending.user.username)) {
			throw new HttpError(409, `Username "${pending.user.username}" sudah dipakai.`);
		}
		db.users.push(pending.user);
		db.credentials.push({
			id: credential.id,
			userId: pending.user.id,
			publicKey: toBase64Url(credential.publicKey),
			counter: credential.counter,
			transports: credential.transports,
			deviceType: credentialDeviceType,
			backedUp: credentialBackedUp,
			createdAt: Date.now()
		});
	});
	createSession(pending.user.id);
	return pending.user;
}

/** Step 1 of login: returns options for navigator.credentials.get(). */
export async function loginOptions() {
	const options = await generateAuthenticationOptions({
		rpID: rpID(),
		// Empty allowCredentials = the device shows every passkey it has for this site.
		allowCredentials: [],
		userVerification: 'required'
	});
	pendingLoginChallenge = options.challenge;
	return options;
}

/** Step 2 of login: checks the signature against the stored public key. */
export async function verifyLogin(response: AuthenticationResponseJSON) {
	const challenge = pendingLoginChallenge;
	pendingLoginChallenge = null;
	if (!challenge) throw new HttpError(400, 'Login kedaluwarsa. Coba lagi.');

	const stored = query((db) => db.credentials.find((c) => c.id === response.id));
	if (!stored) {
		throw new HttpError(
			404,
			'Passkey ini tidak dikenal. Di demo, akun hanya tersimpan di browser tempat Anda mendaftar.'
		);
	}

	const { verified, authenticationInfo } = await verifyAuthenticationResponse({
		response,
		expectedChallenge: challenge,
		expectedOrigin: origin(),
		expectedRPID: rpID(),
		requireUserVerification: true,
		credential: {
			id: stored.id,
			publicKey: fromBase64Url(stored.publicKey),
			counter: stored.counter,
			transports: stored.transports
		}
	});
	if (!verified) throw new HttpError(401, 'Verifikasi passkey gagal.');

	const user = tx((db) => {
		const cred = db.credentials.find((c) => c.id === stored.id)!;
		cred.counter = authenticationInfo.newCounter;
		cred.lastUsedAt = Date.now();
		return db.users.find((u) => u.id === stored.userId)!;
	});
	createSession(user.id);
	return user;
}

export function listPasskeys(userId: string) {
	return query((db) => db.credentials.filter((c) => c.userId === userId));
}
