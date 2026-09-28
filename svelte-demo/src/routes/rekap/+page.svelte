<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { api } from '$lib/api';
	import { auth } from '$lib/auth.svelte';
	import type { AttendanceRecord, Office } from '$lib/backend/db';
	import { downloadCsv, errorMessage, formatDateShort, formatTime, getLocation } from '$lib/util';

	type Row = AttendanceRecord & { name: string };

	let rows = $state<Row[]>([]);
	let office = $state<Office>(null);
	let radius = $state(100);
	let enforce = $state(false);
	let busy = $state(false);
	let message = $state<{ kind: 'ok' | 'error'; text: string } | null>(null);

	async function load() {
		[rows, office] = await Promise.all([api.allRecords(), api.getOffice()]);
		if (office) {
			radius = office.radius;
			enforce = office.enforce;
		}
	}

	onMount(() => {
		if (!auth.user) {
			goto(resolve('/'), { replaceState: true });
			return;
		}
		load();
	});

	async function useMyLocation() {
		busy = true;
		message = null;
		const loc = await getLocation(15000);
		busy = false;
		if (!loc) {
			message = { kind: 'error', text: 'Lokasi tidak didapat. Izinkan akses lokasi lalu coba lagi.' };
			return;
		}
		await save({ lat: loc.lat, lng: loc.lng, radius, enforce });
	}

	async function save(next: Office) {
		try {
			await api.setOffice(next);
			office = next;
			message = { kind: 'ok', text: next ? 'Lokasi kantor disimpan.' : 'Lokasi kantor dihapus.' };
		} catch (err) {
			message = { kind: 'error', text: errorMessage(err) };
		}
	}

	function exportCsv() {
		downloadCsv(`absensi-${new Date().toISOString().slice(0, 10)}.csv`, [
			['Nama', 'Tanggal', 'Jenis', 'Jam', 'Kemiripan (%)', 'Latitude', 'Longitude', 'Akurasi (m)', 'Jarak kantor (m)'],
			...rows.map((r) => [
				r.name,
				r.day,
				r.type === 'in' ? 'Masuk' : 'Pulang',
				formatTime(r.time),
				r.similarity,
				r.location?.lat ?? '',
				r.location?.lng ?? '',
				r.location?.accuracy ?? '',
				r.distance ?? ''
			])
		]);
	}

	async function resetDemo() {
		if (!confirm('Hapus SEMUA data demo di perangkat ini (akun, wajah, absensi)? Passkey di HP perlu dihapus manual dari pengaturan perangkat.')) return;
		await api.resetDemo();
		auth.user = null;
		await goto(resolve('/'));
	}
</script>

<div class="stack">
	<section class="card">
		<div class="head">
			<h2>Rekap absensi</h2>
			<button class="btn sm" type="button" onclick={exportCsv} disabled={!rows.length}>Unduh CSV</button>
		</div>
		{#if rows.length}
			<div class="table-wrap">
				<table>
					<thead>
						<tr><th>Nama</th><th>Tanggal</th><th>Jenis</th><th>Jam</th><th>Wajah</th><th>Lokasi</th></tr>
					</thead>
					<tbody>
						{#each rows as r (r.id)}
							<tr>
								<td>{r.name}</td>
								<td>{formatDateShort(r.time)}</td>
								<td><span class="pill" class:out={r.type === 'out'}>{r.type === 'in' ? 'Masuk' : 'Pulang'}</span></td>
								<td class="num">{formatTime(r.time)}</td>
								<td class="num">{r.similarity}%</td>
								<td class="num">{r.distance !== null ? `${r.distance} m` : r.location ? '✓' : '—'}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{:else}
			<p class="muted small">Belum ada data absensi di perangkat ini.</p>
		{/if}
	</section>

	<section class="card stack">
		<div>
			<h2>Lokasi kantor</h2>
			<p class="muted small">
				{#if office}
					Tersimpan: {office.lat.toFixed(5)}, {office.lng.toFixed(5)} · radius {office.radius} m.
				{:else}
					Belum diatur. Berdiri di kantor, lalu tekan tombol di bawah.
				{/if}
			</p>
		</div>
		<label class="field">
			Radius (meter)
			<input type="number" min="10" max="5000" step="10" bind:value={radius} />
		</label>
		<label class="check">
			<input type="checkbox" bind:checked={enforce} />
			Tolak absen di luar radius
		</label>
		<div class="row">
			<button class="btn primary" type="button" onclick={useMyLocation} disabled={busy}>
				{busy ? 'Mengambil lokasi…' : 'Pakai lokasi saya sekarang'}
			</button>
			{#if office}
				<button class="btn" type="button" onclick={() => save({ ...office!, radius, enforce })}>Simpan radius</button>
				<button class="btn danger" type="button" onclick={() => save(null)}>Hapus</button>
			{/if}
		</div>
		{#if message}
			<p class="alert {message.kind}" role="status">{message.text}</p>
		{/if}
	</section>

	<section class="card">
		<h2>Data demo</h2>
		<p class="muted small">Semua akun dan absensi demo hanya tersimpan di browser ini.</p>
		<button class="btn danger" type="button" onclick={resetDemo}>Hapus semua data demo</button>
	</section>
</div>

<style>
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		margin-bottom: 0.5rem;
	}

	.head h2 {
		margin: 0;
	}

	.table-wrap {
		overflow-x: auto;
		margin: 0 -1.1rem;
		padding: 0 1.1rem;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.875rem;
	}

	th,
	td {
		padding: 0.55rem 0.5rem;
		text-align: left;
		border-bottom: 1px solid var(--border);
		white-space: nowrap;
	}

	th {
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: var(--muted);
	}

	.num {
		font-variant-numeric: tabular-nums;
	}

	.pill {
		padding: 0.1rem 0.5rem;
		border-radius: 999px;
		font-size: 0.75rem;
		font-weight: 600;
		background: var(--primary-soft);
		color: var(--primary);
	}

	.pill.out {
		background: var(--surface-2);
		color: var(--text);
	}

	.check {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.9rem;
	}

	.check input {
		width: 1.15rem;
		height: 1.15rem;
		accent-color: var(--primary);
	}
</style>
