<!--
  Full-screen guided face scan with active liveness.
  mode="enroll": captures 4 samples (straight, both turns, straight) for a new template.
  mode="verify": captures a straight sample before and after the random challenges.
-->
<script lang="ts" module>
	export type ScanResult = {
		samples: number[][];
		thumb: string;
		liveness: { passed: boolean; challenges: string[] };
	};
</script>

<script lang="ts">
	import { onMount } from 'svelte';
	import { cropFace, detectFaces, loadFaceEngine, type DetectedFace } from '$lib/face/engine';
	import { LivenessTracker, PROMPTS, isStraight, randomChallenges, type Challenge } from '$lib/face/liveness';

	type Props = {
		mode: 'enroll' | 'verify';
		title: string;
		onComplete: (result: ScanResult) => void;
		onCancel: () => void;
	};
	let { mode, title, onComplete, onCancel }: Props = $props();

	type Step = { kind: 'straight'; prompt: string } | { kind: 'challenge'; challenge: Challenge; prompt: string };

	const TIMEOUT_MS = 60000;
	const STRAIGHT_DWELL_MS = 600;
	const SAME_PERSON_MAX_DISTANCE = 0.55;

	let video: HTMLVideoElement;
	let stream: MediaStream | null = null;
	let running = false;

	let phase = $state<'loading' | 'scanning' | 'error' | 'done'>('loading');
	let loadingText = $state('Menyiapkan kamera…');
	let errorText = $state('');
	let steps = $state<Step[]>([]);
	let stepIndex = $state(0);
	let hint = $state('');
	let warn = $state(false);
	let mirrored = $state(true);

	let tracker: LivenessTracker;
	let samples: Float32Array[] = [];
	let thumb = '';
	let startedAt = 0;
	let stepStartedAt = 0;

	const progress = $derived(steps.length ? stepIndex / steps.length : 0);
	const prompt = $derived(steps[Math.min(stepIndex, steps.length - 1)]?.prompt ?? '');

	function buildSteps() {
		const challenges = randomChallenges();
		tracker = new LivenessTracker(challenges);
		steps = [
			{ kind: 'straight', prompt: 'Lihat lurus ke kamera' },
			...challenges.map((challenge) => ({ kind: 'challenge' as const, challenge, prompt: PROMPTS[challenge] })),
			{ kind: 'straight', prompt: 'Lihat lurus lagi' }
		];
		stepIndex = 0;
		samples = [];
		thumb = '';
		startedAt = stepStartedAt = performance.now();
		hint = '';
		warn = false;
	}

	function cameraError(err: unknown) {
		const name = (err as { name?: string })?.name;
		if (!navigator.mediaDevices?.getUserMedia) return 'Kamera butuh HTTPS atau localhost.';
		if (name === 'NotAllowedError') return 'Izin kamera ditolak. Izinkan kamera di pengaturan browser.';
		if (name === 'NotFoundError') return 'Kamera tidak ditemukan.';
		if (name === 'NotReadableError') return 'Kamera sedang dipakai aplikasi lain.';
		return `Gagal membuka kamera: ${(err as Error)?.message ?? err}`;
	}

	async function start() {
		phase = 'loading';
		try {
			loadingText = 'Menyiapkan kamera…';
			stream = await navigator.mediaDevices.getUserMedia({
				video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
				audio: false
			});
			video.srcObject = stream;
			await video.play();
			mirrored = stream.getVideoTracks()[0].getSettings().facingMode !== 'environment';
			loadingText = 'Memuat model AI…';
			await loadFaceEngine();
		} catch (err) {
			stopCamera();
			errorText = cameraError(err);
			phase = 'error';
			return;
		}
		buildSteps();
		phase = 'scanning';
		running = true;
		loop();
	}

	function stopCamera() {
		running = false;
		stream?.getTracks().forEach((t) => t.stop());
		stream = null;
	}

	function qualityIssue(faces: DetectedFace[]): string | null {
		if (!faces.length) return 'Arahkan wajah ke dalam bingkai';
		if (faces.length > 1) return 'Pastikan hanya satu wajah yang terlihat';
		const { videoWidth: w, videoHeight: h } = video;
		const { x, y, width, height } = faces[0].box;
		const size = width / Math.min(w, h);
		if (size < 0.2) return 'Dekatkan wajah ke kamera';
		if (size > 0.85) return 'Terlalu dekat, mundur sedikit';
		if (Math.abs((x + width / 2) / w - 0.5) > 0.22 || Math.abs((y + height / 2) / h - 0.5) > 0.25) {
			return 'Posisikan wajah di tengah bingkai';
		}
		return null;
	}

	const distance = (a: Float32Array, b: Float32Array) => Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0));

	function setHint(text: string, isWarn = false) {
		hint = text;
		warn = isWarn;
	}

	function nextStep() {
		stepIndex++;
		stepStartedAt = performance.now();
		navigator.vibrate?.(25);
		if (stepIndex < steps.length) setHint('✓ Bagus!');
	}

	function processFrame(faces: DetectedFace[]) {
		const now = performance.now();
		if (now - startedAt > TIMEOUT_MS) {
			stopCamera();
			errorText = 'Waktu habis. Pastikan wajah terlihat jelas dan cahaya cukup, lalu coba lagi.';
			phase = 'error';
			return;
		}
		const issue = qualityIssue(faces);
		if (issue) return setHint(issue, true);

		const face = faces[0];
		// Anti-swap: every frame must still be the person from the first sample.
		if (samples.length && distance(samples[0], face.descriptor) > SAME_PERSON_MAX_DISTANCE) {
			buildSteps();
			return setHint('Wajah berubah — pemindaian diulang dari awal', true);
		}

		const step = steps[stepIndex];
		if (step.kind === 'straight') {
			if (!isStraight(face.signal)) return setHint('Hadapkan wajah lurus ke kamera', true);
			tracker.calibrate(face.signal);
			// The straight steps also calibrate the resting-mouth baseline for the mouth check.
			if (now - stepStartedAt < STRAIGHT_DWELL_MS || tracker.baseline === null) {
				if (hint.startsWith('Hadapkan') || warn) setHint('');
				return;
			}
			samples.push(face.descriptor);
			if (!thumb) thumb = cropFace(video, face.box);
			nextStep();
		} else if (tracker.update(face.signal)) {
			if (mode === 'enroll' && step.challenge !== 'mouth') samples.push(face.descriptor);
			nextStep();
		} else if (warn) {
			setHint('');
		}

		if (stepIndex >= steps.length) finish();
	}

	function finish() {
		stopCamera();
		phase = 'done';
		navigator.vibrate?.([40, 60, 40]);
		onComplete({
			samples: samples.map((s) => Array.from(s)),
			thumb,
			liveness: { passed: tracker.done, challenges: [...tracker.challenges] }
		});
	}

	async function loop() {
		while (running) {
			if (video.readyState >= 2 && video.videoWidth) {
				try {
					const faces = await detectFaces(video);
					if (running) processFrame(faces);
				} catch (err) {
					console.error(err);
				}
			}
			await new Promise(requestAnimationFrame);
		}
	}

	function cancel() {
		stopCamera();
		onCancel();
	}

	onMount(() => {
		document.body.style.overflow = 'hidden';
		const onKey = (e: KeyboardEvent) => e.key === 'Escape' && cancel();
		addEventListener('keydown', onKey);
		start();
		return () => {
			stopCamera();
			document.body.style.overflow = '';
			removeEventListener('keydown', onKey);
		};
	});
</script>

<div class="scan" role="dialog" aria-modal="true" aria-label={title}>
	<!-- svelte-ignore a11y_media_has_caption -->
	<video bind:this={video} class:mirrored playsinline muted></video>

	{#if phase === 'scanning' || phase === 'done'}
		<div class="oval" class:warn>
			<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
				<ellipse class="track" cx="50" cy="50" rx="49" ry="49" pathLength="100" />
				<ellipse class="bar" cx="50" cy="50" rx="49" ry="49" pathLength="100" style:stroke-dashoffset={100 - progress * 100} />
			</svg>
		</div>
	{/if}

	<div class="top">
		<button class="chip" type="button" onclick={cancel}>Batal</button>
		{#if phase === 'scanning'}
			<div class="dots" aria-label="Langkah {stepIndex + 1} dari {steps.length}">
				{#each steps as _, i}
					<span class:done={i < stepIndex} class:active={i === stepIndex}></span>
				{/each}
			</div>
		{/if}
		<span class="chip ghost">{title}</span>
	</div>

	<div class="bottom" aria-live="polite">
		{#if phase === 'loading'}
			<div class="spinner" aria-hidden="true"></div>
			<p class="prompt">{loadingText}</p>
		{:else if phase === 'scanning'}
			<p class="prompt">{prompt}</p>
			<p class="hint" class:warn>{hint}</p>
		{:else if phase === 'done'}
			<p class="prompt">✓ Selesai</p>
			<p class="hint">Memproses…</p>
		{:else}
			<p class="prompt">Tidak berhasil</p>
			<p class="hint warn">{errorText}</p>
			<div class="actions">
				<button class="btn ghost-dark" type="button" onclick={cancel}>Tutup</button>
				<button class="btn primary" type="button" onclick={start}>Coba lagi</button>
			</div>
		{/if}
	</div>
</div>

<style>
	.scan {
		position: fixed;
		inset: 0;
		z-index: 100;
		background: #000;
		color: #f8fafc;
		container-type: size;
		display: flex;
		flex-direction: column;
		justify-content: space-between;
	}

	video {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	video.mirrored {
		transform: scaleX(-1);
	}

	.oval {
		position: absolute;
		left: 50%;
		top: 45%;
		width: min(66cqw, 44cqh);
		aspect-ratio: 3 / 4;
		transform: translate(-50%, -50%);
		border-radius: 50%;
		box-shadow: 0 0 0 200vmax rgb(0 0 0 / 0.55);
	}

	.oval svg {
		position: absolute;
		inset: -4px;
		width: calc(100% + 8px);
		height: calc(100% + 8px);
		overflow: visible;
	}

	.oval ellipse {
		fill: none;
		stroke-width: 1.8;
	}

	.track {
		stroke: rgb(255 255 255 / 0.35);
	}

	.oval.warn .track {
		stroke: #fbbf24;
		stroke-dasharray: 3 3;
	}

	.bar {
		stroke: #22c55e;
		stroke-linecap: round;
		stroke-dasharray: 100;
		transform: rotate(-90deg);
		transform-origin: 50% 50%;
		transition: stroke-dashoffset 0.35s ease;
	}

	.top,
	.bottom {
		position: relative;
		z-index: 1;
	}

	.top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: max(0.75rem, env(safe-area-inset-top)) 0.75rem 0;
	}

	.chip {
		font: inherit;
		font-size: 0.85rem;
		font-weight: 600;
		padding: 0.45rem 0.9rem;
		border: 1px solid rgb(255 255 255 / 0.15);
		border-radius: 999px;
		background: rgb(15 23 42 / 0.72);
		color: inherit;
		cursor: pointer;
		max-width: 45cqw;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.chip.ghost {
		cursor: default;
	}

	.dots {
		display: flex;
		gap: 0.35rem;
	}

	.dots span {
		width: 0.55rem;
		height: 0.55rem;
		border-radius: 50%;
		background: rgb(255 255 255 / 0.35);
		transition: background 0.2s, transform 0.2s;
	}

	.dots span.active {
		background: #fff;
		transform: scale(1.3);
	}

	.dots span.done {
		background: #22c55e;
	}

	.bottom {
		padding: 0 1rem max(1.5rem, env(safe-area-inset-bottom));
		text-align: center;
		text-shadow: 0 1px 4px rgb(0 0 0 / 0.6);
	}

	.prompt {
		margin: 0;
		font-size: clamp(1.15rem, 5.5cqw, 1.7rem);
		font-weight: 700;
	}

	.hint {
		min-height: 1.5em;
		margin: 0.3rem 0 0;
		color: #cbd5e1;
	}

	.hint.warn {
		color: #fbbf24;
		font-weight: 600;
	}

	.spinner {
		width: 2.25rem;
		height: 2.25rem;
		margin: 0 auto 0.75rem;
		border: 3px solid rgb(255 255 255 / 0.3);
		border-top-color: #fff;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.actions {
		display: flex;
		justify-content: center;
		gap: 0.5rem;
		margin-top: 1rem;
	}

	.btn.ghost-dark {
		background: rgb(255 255 255 / 0.12);
		color: #fff;
		border-color: rgb(255 255 255 / 0.2);
	}

	@media (prefers-reduced-motion: reduce) {
		.bar,
		.dots span {
			transition: none;
		}
	}
</style>
