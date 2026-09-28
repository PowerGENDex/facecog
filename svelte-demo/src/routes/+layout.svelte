<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { goto } from '$app/navigation';
	import { base, resolve } from '$app/paths';
	import { page } from '$app/state';
	import { api } from '$lib/api';
	import { auth, refreshUser } from '$lib/auth.svelte';

	let { children } = $props();
	let ready = $state(false);

	refreshUser().then(() => (ready = true));

	async function logout() {
		await api.logout();
		auth.user = null;
		await goto(resolve('/'));
	}
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Absensi Wajah · Maca Beungeut</title>
</svelte:head>

<header class="topbar">
	<a class="brand" href={resolve(auth.user ? '/absen' : '/')}>
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
			<circle cx="12" cy="11" r="4" />
		</svg>
		<span>Absensi <small>Maca Beungeut</small></span>
	</a>
	{#if auth.user}
		<button class="btn sm" type="button" onclick={logout}>Keluar</button>
	{/if}
</header>

{#if auth.user}
	<nav class="tabs">
		<a href={resolve('/absen')} aria-current={page.url.pathname.endsWith('/absen') ? 'page' : undefined}>Absen</a>
		<a href={resolve('/rekap')} aria-current={page.url.pathname.endsWith('/rekap') ? 'page' : undefined}>Rekap</a>
	</nav>
{/if}

<main>
	{#if ready}
		{@render children()}
	{/if}
</main>

<footer class="muted small">
	<p>
		<b>Mode demo:</b> "server" disimulasikan di browser ini, jadi akun &amp; data absensi hanya tersimpan di perangkat
		ini. Kode bagian server ada di <code>src/lib/backend/</code> dan siap dipindah ke server sungguhan.
	</p>
	<p><a href="{base}/../" data-sveltekit-reload>← Kembali ke demo Face Recognition</a></p>
</footer>

<style>
	.topbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.75rem 1.1rem;
		padding-top: max(0.75rem, env(safe-area-inset-top));
		background: var(--surface);
		border-bottom: 1px solid var(--border);
	}

	.brand {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		font-weight: 700;
		font-size: 1.1rem;
		color: var(--text);
		text-decoration: none;
	}

	.brand small {
		font-weight: 500;
		color: var(--muted);
		font-size: 0.85rem;
	}

	.brand svg {
		width: 1.6rem;
		height: 1.6rem;
		fill: none;
		stroke: var(--primary);
		stroke-width: 2;
		stroke-linecap: round;
	}

	.tabs {
		display: flex;
		gap: 0.25rem;
		padding: 0 1.1rem;
		background: var(--surface);
		border-bottom: 1px solid var(--border);
	}

	.tabs a {
		padding: 0.7rem 1rem;
		font-weight: 600;
		color: var(--muted);
		text-decoration: none;
		border-bottom: 2px solid transparent;
	}

	.tabs a[aria-current='page'] {
		color: var(--text);
		border-bottom-color: var(--primary);
	}

	main {
		max-width: 640px;
		margin: 0 auto;
		padding: 1.1rem 1rem 1.5rem;
	}

	footer {
		max-width: 640px;
		margin: 0 auto;
		padding: 0 1rem 2rem;
	}

	code {
		font-size: 0.85em;
	}
</style>
