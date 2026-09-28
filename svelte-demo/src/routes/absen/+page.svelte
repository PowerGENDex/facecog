<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import FaceScan, { type ScanResult } from '$lib/components/FaceScan.svelte';
	import { api } from '$lib/api';
	import { auth } from '$lib/auth.svelte';
	import type { AttendanceRecord, AttendanceType, FaceTemplate, Office } from '$lib/backend/db';
	import { errorMessage, formatDate, formatDateShort, formatTime, getLocation } from '$lib/util';

	let face = $state<FaceTemplate | null>(null);
	let history = $state<AttendanceRecord[]>([]);
	let office = $state<Office>(null);
	let loaded = $state(false);

	let scan = $state<{ mode: 'enroll' } | { mode: 'verify'; type: AttendanceType } | null>(null);
	let processing = $state(false);
	let result = $state<{ ok: true; record: AttendanceRecord } | { ok: false; message: string; type?: AttendanceType } | null>(
		null
	);
	let notice = $state('');
	let locationPromise: ReturnType<typeof getLocation> | null = null;

	const today = $derived(history.filter((r) => isToday(r.time)));
	const checkIn = $derived(today.find((r) => r.type === 'in'));
	const checkOut = $derived(today.find((r) => r.type === 'out'));
	const nextType = $derived<AttendanceType | null>(!checkIn ? 'in' : !checkOut ? 'out' : null);
	const days = $derived(groupByDay(history));

	function isToday(t: number) {
		return new Date(t).toDateString() === new Date().toDateString();
	}

	function groupByDay(records: AttendanceRecord[]) {
		const map = new Map<string, { day: string; time: number; in?: AttendanceRecord; out?: AttendanceRecord }>();
		for (const r of records) {
			const entry = map.get(r.day) ?? { day: r.day, time: r.time };
			entry[r.type] = r;
			map.set(r.day, entry);
		}
		return [...map.values()];
	}

	async function load() {
		[face, history, office] = await Promise.all([api.myFace(), api.myHistory(), api.getOffice()]);
		loaded = true;
	}

	onMount(() => {
		if (!auth.user) {
			goto(resolve('/'), { replaceState: true });
			return;
		}
		load();
	});

	function startAttendance(type: AttendanceType) {
		result = null;
		notice = '';
		// Ask for GPS while the face scan runs, so the two waits overlap.
		locationPromise = getLocation();
		scan = { mode: 'verify', type };
	}

	function startEnroll() {
		result = null;
		notice = '';
		scan = { mode: 'enroll' };
	}

	async function onScanComplete(res: ScanResult) {
		const current = scan;
		processing = true;
		try {
			if (current?.mode === 'enroll') {
				face = await api.enrollFace({ samples: res.samples, thumb: res.thumb });
				notice = 'Wajah berhasil didaftarkan. Sekarang Anda bisa absen.';
			} else if (current?.mode === 'verify') {
				const location = await locationPromise;
				const record = await api.recordAttendance({
					type: current.type,
					samples: res.samples,
					liveness: res.liveness,
					location
				});
				result = { ok: true, record };
				await load();
			}
		} catch (err) {
			result = { ok: false, message: errorMessage(err), type: current?.mode === 'verify' ? current.type : undefined };
		} finally {
			scan = null;
			processing = false;
		}
	}

	const label = (type: AttendanceType) => (type === 'in' ? 'masuk' : 'pulang');

	function locationText(r: AttendanceRecord) {
		if (!r.location) return 'Lokasi tidak tersedia';
		if (r.distance !== null) return `${r.distance} m dari kantor (akurasi ±${r.location.accuracy} m)`;
		return `Lokasi tercatat (akurasi ±${r.location.accuracy} m)`;
	}
</script>

{#if scan}
	<FaceScan
		mode={scan.mode}
		title={scan.mode === 'enroll' ? 'Daftar wajah' : `Absen ${label(scan.type)}`}
		onComplete={onScanComplete}
		onCancel={() => (scan = null)}
	/>
{/if}

{#if auth.user && loaded}
	<section class="greet">
		<p class="muted small">{formatDate(Date.now())}</p>
		<h1>Halo, {auth.user.displayName.split(' ')[0]} 👋</h1>
	</section>

	<div class="stack">
		{#if notice}
			<p class="alert ok" role="status">{notice}</p>
		{/if}

		{#if !face}
			<section class="card stack highlight">
				<div>
					<h2>Langkah 1: Daftarkan wajah</h2>
					<p class="muted small">
						Sekali saja. Ikuti petunjuk di layar: lihat lurus, buka-tutup mulut, dan toleh ke kiri &amp; kanan.
					</p>
				</div>
				<button class="btn primary lg block" type="button" onclick={startEnroll}>Daftarkan wajah</button>
			</section>
		{/if}

		<section class="card stack">
			<h2>Absen hari ini</h2>
			<div class="tiles">
				<div class="tile" class:filled={checkIn}>
					<span class="muted small">Masuk</span>
					<strong>{checkIn ? formatTime(checkIn.time) : '—'}</strong>
				</div>
				<div class="tile" class:filled={checkOut}>
					<span class="muted small">Pulang</span>
					<strong>{checkOut ? formatTime(checkOut.time) : '—'}</strong>
				</div>
			</div>

			{#if result?.ok}
				<div class="alert ok result" role="status">
					<strong>✓ Absen {label(result.record.type)} tercatat pukul {formatTime(result.record.time)}</strong>
					<span>Kemiripan wajah {result.record.similarity}% · {locationText(result.record)}</span>
				</div>
			{:else if result}
				<div class="alert error result" role="alert">
					<strong>Absen gagal</strong>
					<span>{result.message}</span>
				</div>
			{/if}

			{#if nextType}
				<button
					class="btn primary lg block"
					type="button"
					onclick={() => startAttendance(nextType!)}
					disabled={!face || processing}
				>
					{processing ? 'Memproses…' : nextType === 'in' ? 'Absen Masuk' : 'Absen Pulang'}
				</button>
				{#if !face}<p class="muted small">Daftarkan wajah dulu untuk bisa absen.</p>{/if}
			{:else}
				<p class="alert ok">✓ Absen hari ini sudah lengkap. Sampai besok!</p>
			{/if}

			<p class="muted small">
				{#if office}
					📍 Radius kantor {office.radius} m{office.enforce ? ' (wajib di dalam radius)' : ' (hanya dicatat)'}.
				{:else}
					📍 Lokasi kantor belum diatur — lokasi hanya dicatat. Atur di tab <a href={resolve('/rekap')}>Rekap</a>.
				{/if}
			</p>
		</section>

		<section class="card">
			<h2>Riwayat saya</h2>
			{#if days.length}
				<ul class="history">
					{#each days as d (d.day)}
						<li>
							<span>{formatDateShort(d.time)}</span>
							<span class="times">
								<span title="Masuk">▲ {d.in ? formatTime(d.in.time) : '—'}</span>
								<span title="Pulang">▼ {d.out ? formatTime(d.out.time) : '—'}</span>
							</span>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="muted small">Belum ada riwayat absen.</p>
			{/if}
		</section>

		{#if face}
			<section class="card row face">
				{#if face.thumb}<img class="avatar" src={face.thumb} alt="" />{/if}
				<div class="grow">
					<strong>Wajah terdaftar</strong>
					<p class="muted small">{face.descriptors.length} sampel · {formatDateShort(face.updatedAt)}</p>
				</div>
				<button class="btn sm" type="button" onclick={startEnroll}>Daftar ulang</button>
			</section>
		{/if}
	</div>
{/if}

<style>
	.greet {
		margin: 0.25rem 0 1rem;
	}

	.greet p {
		margin: 0;
	}

	.highlight {
		border-color: var(--primary);
	}

	.tiles {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.75rem;
	}

	.tile {
		display: flex;
		flex-direction: column;
		padding: 0.8rem 0.9rem;
		border-radius: 12px;
		background: var(--surface-2);
	}

	.tile strong {
		font-size: 1.6rem;
		font-variant-numeric: tabular-nums;
	}

	.tile.filled {
		background: var(--primary-soft);
	}

	.tile.filled strong {
		color: var(--primary);
	}

	.result {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}

	.history {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.history li {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.6rem 0;
		border-bottom: 1px solid var(--border);
	}

	.history li:last-child {
		border-bottom: 0;
	}

	.times {
		display: flex;
		gap: 1rem;
		font-variant-numeric: tabular-nums;
	}

	.face {
		flex-wrap: nowrap;
	}

	.face p {
		margin: 0;
	}

	.grow {
		flex: 1;
		min-width: 0;
	}
</style>
