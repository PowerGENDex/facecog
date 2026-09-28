<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import {
		browserSupportsWebAuthn,
		platformAuthenticatorIsAvailable,
		startAuthentication,
		startRegistration
	} from '@simplewebauthn/browser';
	import { api } from '$lib/api';
	import { auth } from '$lib/auth.svelte';
	import { errorMessage } from '$lib/util';

	let tab = $state<'login' | 'register'>('login');
	let displayName = $state('');
	let username = $state('');
	let busy = $state(false);
	let error = $state('');
	let supported = $state(true);
	let hasBiometrics = $state<boolean | null>(null);

	onMount(async () => {
		if (auth.user) return goto(resolve('/absen'), { replaceState: true });
		supported = browserSupportsWebAuthn();
		hasBiometrics = supported ? await platformAuthenticatorIsAvailable() : false;
	});

	async function run(action: () => Promise<void>) {
		busy = true;
		error = '';
		try {
			await action();
			await goto(resolve('/absen'));
		} catch (err) {
			error = errorMessage(err);
		} finally {
			busy = false;
		}
	}

	// Login: server sends a challenge -> the device signs it after Face ID/fingerprint -> server checks the signature.
	const login = () =>
		run(async () => {
			const optionsJSON = await api.loginOptions();
			const response = await startAuthentication({ optionsJSON });
			auth.user = await api.verifyLogin(response);
		});

	// Sign-up: the device creates a key pair; only the public key is sent to the server.
	function register(e: SubmitEvent) {
		e.preventDefault();
		return run(async () => {
			const optionsJSON = await api.registrationOptions({ username, displayName });
			const response = await startRegistration({ optionsJSON });
			auth.user = await api.verifyRegistration(response);
		});
	}

	function switchTab(next: 'login' | 'register') {
		tab = next;
		error = '';
	}
</script>

<section class="hero">
	<h1>Absen pakai wajah</h1>
	<p class="muted">Masuk tanpa password dengan passkey, lalu absen dengan scan wajah + cek wajah asli + lokasi.</p>
</section>

{#if !supported}
	<p class="alert error">Browser ini belum mendukung passkey. Coba Chrome, Safari, atau Edge versi terbaru.</p>
{/if}

<div class="card stack">
	<div class="segmented" role="tablist">
		<button role="tab" aria-selected={tab === 'login'} onclick={() => switchTab('login')}>Masuk</button>
		<button role="tab" aria-selected={tab === 'register'} onclick={() => switchTab('register')}>Daftar</button>
	</div>

	{#if tab === 'login'}
		<p class="muted small">
			Tekan tombol di bawah. Perangkat akan meminta <b>Face ID, sidik jari, atau PIN layar</b> — tanpa password.
		</p>
		<button class="btn primary lg block" type="button" onclick={login} disabled={busy || !supported}>
			<svg viewBox="0 0 24 24" aria-hidden="true">
				<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
				<path d="M9 10v1M15 10v1M12 10v3h-1M9.5 16a3.5 3.5 0 0 0 5 0" />
			</svg>
			{busy ? 'Menunggu verifikasi…' : 'Masuk dengan passkey'}
		</button>
		<p class="muted small center">
			Belum punya akun? <button class="link" type="button" onclick={() => switchTab('register')}>Daftar dulu</button>
		</p>
	{:else}
		<form class="stack" onsubmit={register}>
			<label class="field">
				Nama lengkap
				<input type="text" bind:value={displayName} placeholder="mis. Siti Rahma" maxlength="60" required autocomplete="name" />
			</label>
			<label class="field">
				Username
				<input
					type="text"
					bind:value={username}
					placeholder="mis. siti.rahma"
					maxlength="30"
					required
					autocomplete="username webauthn"
					autocapitalize="none"
					spellcheck="false"
				/>
			</label>
			<button class="btn primary lg block" type="submit" disabled={busy || !supported}>
				{busy ? 'Menunggu verifikasi…' : 'Buat akun dengan passkey'}
			</button>
			<p class="muted small">
				Tidak ada password. Perangkat Anda membuat kunci rahasia yang hanya bisa dibuka dengan Face ID / sidik jari /
				PIN layar. Server hanya menyimpan "gembok"-nya (kunci publik).
			</p>
		</form>
	{/if}

	{#if error}
		<p class="alert error" role="alert">{error}</p>
	{/if}
	{#if hasBiometrics === false && supported}
		<p class="alert warn small">
			Perangkat ini tidak punya Face ID/sidik jari yang terdeteksi. Browser mungkin menawarkan PIN layar, kunci
			keamanan, atau scan QR pakai HP.
		</p>
	{/if}
</div>

<section class="card steps">
	<h2>Alur demo</h2>
	<ol>
		<li><b>Daftar akun</b> dengan passkey (Face ID / sidik jari).</li>
		<li><b>Daftarkan wajah</b> sekali — dipandu di layar.</li>
		<li>
			<b>Absen masuk/pulang</b>: scan wajah + tantangan acak (buka mulut, toleh kiri/kanan) supaya tidak bisa pakai foto,
			plus lokasi GPS.
		</li>
	</ol>
</section>

<style>
	.hero {
		margin: 0.5rem 0 1.25rem;
	}

	.hero h1 {
		font-size: clamp(1.6rem, 6vw, 2.1rem);
	}

	.segmented {
		display: grid;
		grid-template-columns: 1fr 1fr;
		padding: 4px;
		border-radius: 12px;
		background: var(--surface-2);
	}

	.segmented button {
		font: inherit;
		font-weight: 600;
		min-height: 2.5rem;
		border: 0;
		border-radius: 9px;
		background: transparent;
		color: var(--muted);
		cursor: pointer;
	}

	.segmented button[aria-selected='true'] {
		background: var(--surface);
		color: var(--text);
		box-shadow: var(--shadow);
	}

	.center {
		text-align: center;
	}

	.link {
		font: inherit;
		padding: 0;
		border: 0;
		background: none;
		color: var(--primary);
		font-weight: 600;
		cursor: pointer;
	}

	.steps {
		margin-top: 1rem;
	}

	.steps ol {
		margin: 0;
		padding-left: 1.25rem;
		display: grid;
		gap: 0.4rem;
	}
</style>
