import type { User } from './backend/db.ts';
import { api } from './api.ts';

/** Current user, shared by all pages. */
export const auth = $state<{ user: User | null }>({ user: null });

export async function refreshUser() {
	auth.user = await api.me();
	return auth.user;
}
