import { ApiError } from './api.ts';
import type { Location } from './backend/attendance.ts';

/** Current GPS position, or null if unavailable/denied (never throws). */
export function getLocation(timeoutMs = 10000): Promise<Location> {
	return new Promise((resolve) => {
		if (!navigator.geolocation) return resolve(null);
		navigator.geolocation.getCurrentPosition(
			(pos) =>
				resolve({
					lat: pos.coords.latitude,
					lng: pos.coords.longitude,
					accuracy: Math.round(pos.coords.accuracy)
				}),
			() => resolve(null),
			{ enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30000 }
		);
	});
}

export const formatTime = (t: number) => new Date(t).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

export const formatDate = (t: number) =>
	new Date(t).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

export const formatDateShort = (t: number) =>
	new Date(t).toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' });

function csvCell(value: unknown) {
	let s = String(value ?? '');
	// Avoid spreadsheet formula injection in text (numbers like -6.9 are left alone).
	if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
	return `"${s.replaceAll('"', '""')}"`;
}

export function downloadCsv(filename: string, rows: unknown[][]) {
	const csv = '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
	const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
	const a = Object.assign(document.createElement('a'), { href: url, download: filename });
	document.body.append(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Human-readable message for a WebAuthn failure from @simplewebauthn/browser. */
export function passkeyError(err: unknown): string {
	const e = err as { name?: string; code?: string; message?: string };
	if (e?.name === 'NotAllowedError') return 'Dibatalkan atau waktu habis. Coba lagi.';
	if (e?.code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED' || e?.name === 'InvalidStateError') {
		return 'Passkey untuk akun ini sudah ada di perangkat Anda.';
	}
	if (e?.name === 'SecurityError') return 'Passkey hanya bisa dipakai lewat HTTPS atau localhost.';
	return e?.message ?? 'Terjadi kesalahan.';
}

/** Message for any error thrown by an api call or a passkey prompt. */
export const errorMessage = (err: unknown) => (err instanceof ApiError ? err.message : passkeyError(err));
