/**
 * Unified subtle 3D tilt for physical cards (polaroids, menus, envelope).
 * Desktop: per-card cursor tracking. Mobile: deviceorientation gyro.
 * Writes --tilt-x / --tilt-y (deg) and --shadow-x / --shadow-y (px).
 */

type OrientationPermission = {
	requestPermission?: () => Promise<'granted' | 'denied' | 'default'>;
};

const MAX_TILT_MOUSE = 4.5;
const MAX_TILT_GYRO = 15;
const LERP = 0.16;
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
	const shadowScale = Math.max(Math.abs(x), Math.abs(y), 0.01);
	const shadowDenom = Math.max(shadowScale, MAX_TILT_MOUSE);
	el.style.setProperty('--tilt-x', `${x.toFixed(2)}deg`);
	el.style.setProperty('--tilt-y', `${y.toFixed(2)}deg`);
	el.style.setProperty('--shadow-x', `${(-y * (SHADOW / shadowDenom)).toFixed(2)}px`);
	el.style.setProperty('--shadow-y', `${(14 + x * (SHADOW / shadowDenom)).toFixed(2)}px`);
};

export function initTiltEffect() {
	const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
	const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');

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
	let orientationListening = false;
	let permissionBusy = false;
	let rafId = 0;
	let running = false;

	const tick = () => {
		let busy = false;

		for (const state of states) {
			/* Mouse hover wins on that card; otherwise use gyro when available */
			const useGyro = gyroActive && !state.hovering;
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

		state.targetX = clamp(-py * 2 * MAX_TILT_MOUSE, -MAX_TILT_MOUSE, MAX_TILT_MOUSE);
		state.targetY = clamp(px * 2 * MAX_TILT_MOUSE, -MAX_TILT_MOUSE, MAX_TILT_MOUSE);
		state.hovering = true;
		startLoop();
	};

	/** Desktop cursor tilt (mouse only — never steal touch) */
	for (const state of states) {
		state.el.addEventListener('pointermove', (event) => {
			if (event.pointerType !== 'mouse') return;
			if (!finePointer.matches) return;
			setFromPointer(state, event.clientX, event.clientY);
		});

		state.el.addEventListener('pointerleave', () => {
			if (!state.hovering) return;
			state.hovering = false;
			state.targetX = 0;
			state.targetY = 0;
			startLoop();
		});
	}

	const onOrientation = (event: DeviceOrientationEvent) => {
		const beta = event.beta;
		const gamma = event.gamma;
		if (beta == null && gamma == null) return;

		const b = beta ?? BETA_REST;
		const g = gamma ?? 0;

		/* Stronger mobile range — reaches ±MAX_TILT_GYRO with moderate hand motion */
		gyroX = clamp((b - BETA_REST) / 4.5, -MAX_TILT_GYRO, MAX_TILT_GYRO);
		gyroY = clamp(g / 4.5, -MAX_TILT_GYRO, MAX_TILT_GYRO);
		gyroActive = true;
		startLoop();
	};

	const startOrientationListener = () => {
		if (orientationListening) return;
		orientationListening = true;
		window.addEventListener('deviceorientation', onOrientation, { passive: true });
		/* Some Android WebViews expose this absolute variant instead */
		window.addEventListener('deviceorientationabsolute', onOrientation as EventListener, {
			passive: true,
		});
	};

	const enableGyro = async () => {
		if (orientationListening || permissionBusy) return;
		permissionBusy = true;

		const Orientation = DeviceOrientationEvent as unknown as OrientationPermission;
		try {
			if (typeof Orientation.requestPermission === 'function') {
				const state = await Orientation.requestPermission();
				permissionBusy = false;
				if (state !== 'granted') return;
				startOrientationListener();
				return;
			}

			permissionBusy = false;
			startOrientationListener();
		} catch {
			permissionBusy = false;
		}
	};

	/**
	 * Keep asking on interaction until listening starts.
	 * (A single once-listener often fires during intro and gets skipped.)
	 */
	const onInteract = () => {
		void enableGyro();
	};
	window.addEventListener('touchstart', onInteract, { passive: true });
	window.addEventListener('touchend', onInteract, { passive: true });
	window.addEventListener('click', onInteract, { passive: true });

	/* Non-iOS: start immediately (no permission API) */
	const Orientation = DeviceOrientationEvent as unknown as OrientationPermission;
	if (typeof Orientation.requestPermission !== 'function') {
		startOrientationListener();
	}

	states.forEach((state) => applyVars(state.el, 0, 0));

	window.addEventListener(
		'pagehide',
		() => {
			if (rafId) cancelAnimationFrame(rafId);
		},
		{ once: true },
	);
}
