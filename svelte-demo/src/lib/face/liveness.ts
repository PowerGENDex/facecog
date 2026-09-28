// Active liveness checks from 68-point face landmarks. Pure functions only (no DOM,
// no face-api) so the logic is unit-testable: see liveness.test.ts.
//
// This stops the easy attacks (a printed photo or a still image on a phone) because
// the person has to react to prompts given in random order. It is NOT certified
// presentation-attack detection: a live replay, a mask or a virtual camera can still
// beat it. Production systems should verify liveness on the server with a certified
// (ISO 30107-3) service.

export type Point = { x: number; y: number };
export type Challenge = 'mouth' | 'left' | 'right';

/** Per-frame measurements the liveness checks need. */
export type FaceSignal = {
	/** Head yaw estimate: ~0 looking straight, sign flips with direction. */
	yaw: number;
	/** Mouth aspect ratio (inner lips): ~0-0.1 closed, >0.25 clearly open. */
	mar: number;
	/** Timestamp in ms. */
	t: number;
};

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Mouth aspect ratio from the 8 inner-lip landmarks (60-67): mean lip gap over mouth width.
 *
 * We use the mouth rather than a blink: face-api's 68-point model barely moves the eye
 * landmarks when eyes close, but it tracks the lips well (real faces measure ~0.02-0.1
 * with lips closed and 0.2-0.36 when laughing).
 */
export function mouthAspectRatio(inner: Point[]): number {
	const [p60, p61, p62, p63, p64, p65, p66, p67] = inner;
	const width = dist(p60, p64) || 1;
	return (dist(p61, p67) + dist(p62, p66) + dist(p63, p65)) / (3 * width);
}

/** Computes the per-frame signal from the 68 landmark positions. */
export function faceSignal(points: Point[], t: number): FaceSignal {
	const [outerL, outerR, nose] = [points[36], points[45], points[30]];
	const eyeDist = dist(outerL, outerR) || 1;
	return {
		yaw: (nose.x - (outerL.x + outerR.x) / 2) / eyeDist,
		mar: mouthAspectRatio(points.slice(60, 68)),
		t
	};
}

export const YAW_STRAIGHT = 0.08;
export const YAW_TURNED = 0.12;
/** Mouth counts as open above max(MOUTH_OPEN_MIN, baseline + MOUTH_OPEN_DELTA)... */
export const MOUTH_OPEN_MIN = 0.2;
export const MOUTH_OPEN_DELTA = 0.12;
/** ...and as closed again below baseline + MOUTH_CLOSED_DELTA. */
export const MOUTH_CLOSED_DELTA = 0.06;

export const PROMPTS: Record<Challenge, string> = {
	mouth: 'Buka mulut lebar, lalu tutup',
	left: 'Toleh ke kiri',
	right: 'Toleh ke kanan'
};

/** Returns the three challenges in a random order, so a pre-recorded clip can't anticipate them. */
export function randomChallenges(random: () => number = Math.random): Challenge[] {
	const list: Challenge[] = ['mouth', 'left', 'right'];
	for (let i = list.length - 1; i > 0; i--) {
		const j = Math.floor(random() * (i + 1));
		[list[i], list[j]] = [list[j], list[i]];
	}
	return list;
}

export const isStraight = (s: FaceSignal) => Math.abs(s.yaw) < YAW_STRAIGHT;

/**
 * Tracks progress through a list of challenges, one frame at a time.
 *
 * "Left" and "right" are checked relative to each other (the second turn must be to the
 * opposite side of the first) rather than by absolute sign, so the check does not depend
 * on camera mirroring or on which way the yaw estimate is signed.
 */
export class LivenessTracker {
	readonly challenges: Challenge[];
	index = 0;
	private baselineMar: number[] = [];
	private mouthOpened = false;
	private firstTurnSide = 0;

	constructor(challenges: Challenge[]) {
		this.challenges = challenges;
	}

	get done() {
		return this.index >= this.challenges.length;
	}

	get current(): Challenge | undefined {
		return this.challenges[this.index];
	}

	/** Median resting-mouth MAR seen so far (null until there are enough samples). */
	get baseline(): number | null {
		if (this.baselineMar.length < 3) return null;
		const sorted = [...this.baselineMar].sort((a, b) => a - b);
		return sorted[Math.floor(sorted.length / 2)];
	}

	/** Records a straight-ahead, resting frame to calibrate the mouth check. */
	calibrate(signal: FaceSignal) {
		if (!isStraight(signal)) return;
		this.baselineMar.push(signal.mar);
		if (this.baselineMar.length > 15) this.baselineMar.shift();
	}

	/** Feeds one frame. Returns true when the current challenge was just completed. */
	update(signal: FaceSignal): boolean {
		const challenge = this.current;
		if (!challenge) return false;
		let passed = false;

		if (challenge === 'mouth') {
			const base = this.baseline;
			if (base === null) {
				this.calibrate(signal);
				return false;
			}
			// Must open and then close again: a photo with an open mouth never "closes".
			if (!this.mouthOpened && signal.mar > Math.max(MOUTH_OPEN_MIN, base + MOUTH_OPEN_DELTA)) this.mouthOpened = true;
			else if (this.mouthOpened && signal.mar < base + MOUTH_CLOSED_DELTA) passed = true;
		} else {
			const side = Math.sign(signal.yaw);
			const turned = Math.abs(signal.yaw) > YAW_TURNED;
			if (turned && (this.firstTurnSide === 0 || side !== this.firstTurnSide)) {
				if (this.firstTurnSide === 0) this.firstTurnSide = side;
				passed = true;
			}
		}

		if (passed) {
			this.index++;
			this.mouthOpened = false;
		}
		return passed;
	}
}
