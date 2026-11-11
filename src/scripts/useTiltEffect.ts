/**
 * Unified subtle 3D tilt for physical cards (polaroids, menus, envelope).
 * Desktop: per-card cursor tracking. Mobile: deviceorientation gyro.
 * Writes --tilt-x / --tilt-y (deg) and --shadow-x / --shadow-y (px).
 */

type OrientationPermission = {
	requestPermission?: () => Promise<'granted' | 'denied' | 'default'>;
};

const MAX_TILT = 4.5;
const LERP = 0.14;
const SHADOW = 14;
/** Typical upright phone pitch treated as neutral */
const BETA_REST = 45;

type CardState = {
	el: HTMLElement;
	targetX: number;
	targetY: number;
	currentX: number;
	currentY: number;
	hovering: boolean;
};

const clamp = (value: number, min: number, max: number) =>
	Math.min(max, Math.max(min, value));

const lerp = (from: number, to: number, amount: number) => from + (to - from) * amount;

const applyVars = (el: HTMLElement, x: number, y: number) => {
	el.style.setProperty('--tilt-x', `${x.toFixed(2)}deg`);
	el.style.setProperty('--tilt-y', `${y.toFixed(2)}deg`);
	el.style.setProperty('--shadow-x', `${(-y * (SHADOW / MAX_TILT)).toFixed(2)}px`);
	el.style.setProperty('--shadow-y', `${(14 + x * (SHADOW / MAX_TILT)).toFixed(2)}px`);
};

export function initTiltEffect() {
	const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
	const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
	const coarsePointer = window.matchMedia('(pointer: coarse)');

	if (reduceMotion.matches) return;

	const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-tilt]'));
	if (!cards.length) return;

	const states: CardState[] = cards.map((el) => ({
		el,
		targetX: 0,
		targetY: 0,
		currentX: 0,
		currentY: 0,
		hovering: false,
	}));

	let gyroX = 0;
	let gyroY = 0;
	let gyroActive = false;
	let permissionAsked = false;
	let rafId = 0;
	let running = false;

	const tick = () => {
		let busy = false;

		for (const state of states) {
			const useGyro = gyroActive && !state.hovering && !finePointer.matches;
			const tx = useGyro ? gyroX : state.targetX;
			const ty = useGyro ? gyroY : state.targetY;

			state.currentX = lerp(state.currentX, tx, LERP);
			state.currentY = lerp(state.currentY, ty, LERP);
			if (Math.abs(state.currentX - tx) < 0.01) state.currentX = tx;
			if (Math.abs(state.currentY - ty) < 0.01) state.currentY = ty;

			applyVars(state.el, state.currentX, state.currentY);

			if (
				state.hovering ||
				gyroActive ||
				state.currentX !== 0 ||
				state.currentY !== 0 ||
				tx !== 0 ||
				ty !== 0
			) {
				busy = true;
			}
		}

		if (!busy) {
			running = false;
			rafId = 0;
			return;
		}

		rafId = requestAnimationFrame(tick);
	};

	const startLoop = () => {
		if (running) return;
		running = true;
		rafId = requestAnimationFrame(tick);
	};

	const setFromPointer = (state: CardState, clientX: number, clientY: number) => {
		const rect = state.el.getBoundingClientRect();
		if (rect.width < 1 || rect.height < 1) return;

		const px = (clientX - rect.left) / rect.width - 0.5;
		const py = (clientY - rect.top) / rect.height - 0.5;

		state.targetX = clamp(-py * 2 * MAX_TILT, -MAX_TILT, MAX_TILT);
		state.targetY = clamp(px * 2 * MAX_TILT, -MAX_TILT, MAX_TILT);
		state.hovering = true;
		startLoop();
	};

	/** Desktop / fine pointer: per-card cursor tilt */
	for (const state of states) {
		state.el.addEventListener('pointermove', (event) => {
			if (!finePointer.matches || event.pointerType !== 'mouse') return;
			setFromPointer(state, event.clientX, event.clientY);
		});

		state.el.addEventListener('pointerleave', () => {
			state.hovering = false;
			state.targetX = 0;
			state.targetY = 0;
			startLoop();
		});
	}

	/** Mobile gyro → same ±MAX_TILT range */
	const onOrientation = (event: DeviceOrientationEvent) => {
		if (finePointer.matches) return;

		const beta = event.beta ?? BETA_REST;
		const gamma = event.gamma ?? 0;

		/* Neutral around a natural handheld pitch; gamma is left/right */
		gyroX = clamp((beta - BETA_REST) / 12, -MAX_TILT, MAX_TILT);
		gyroY = clamp(gamma / 12, -MAX_TILT, MAX_TILT);
		gyroActive = true;
		startLoop();
	};

	const enableGyro = async () => {
		if (permissionAsked || finePointer.matches) return;
		permissionAsked = true;

		const Orientation = DeviceOrientationEvent as unknown as OrientationPermission;
		try {
			if (typeof Orientation.requestPermission === 'function') {
				const state = await Orientation.requestPermission();
				if (state !== 'granted') return;
			}
			window.addEventListener('deviceorientation', onOrientation, { passive: true });
		} catch {
			/* denied / unavailable */
		}
	};

	const unlock = () => {
		void enableGyro();
	};
	window.addEventListener('pointerdown', unlock, { once: true, passive: true });
	window.addEventListener('touchstart', unlock, { once: true, passive: true });

	/* Non-iOS: listen immediately on coarse pointers */
	const Orientation = DeviceOrientationEvent as unknown as OrientationPermission;
	if (
		coarsePointer.matches &&
		typeof Orientation.requestPermission !== 'function'
	) {
		window.addEventListener('deviceorientation', onOrientation, { passive: true });
	}

	/* Seed neutral vars */
	states.forEach((state) => applyVars(state.el, 0, 0));

	window.addEventListener(
		'pagehide',
		() => {
			if (rafId) cancelAnimationFrame(rafId);
		},
		{ once: true },
	);
}
