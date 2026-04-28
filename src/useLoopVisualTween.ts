import {createEffect, createMemo, createSignal, onCleanup} from "solid-js";

type HsvColor = {
	h: number;
	s: number;
	v: number;
};

type LoopVisualVars = Record<`--${string}`, string>;

const TWEEN_MS = 120;
const INACTIVE: HsvColor = {h: 210, s: 3, v: 96};
const ACTIVE: HsvColor = {h: 163, s: 54, v: 85};

function clamp01(value: number): number {
	return Math.max(0, Math.min(1, value));
}

function easeOutCubic(value: number): number {
	const inverse = 1 - clamp01(value);
	return 1 - inverse * inverse * inverse;
}

function lerp(start: number, end: number, progress: number): number {
	return start + (end - start) * progress;
}

function mixHue(start: number, end: number, progress: number): number {
	const delta = ((((end - start) % 360) + 540) % 360) - 180;
	return (start + delta * progress + 360) % 360;
}

function mixHsv(start: HsvColor, end: HsvColor, progress: number): HsvColor {
	const amount = clamp01(progress);
	return {
		h: mixHue(start.h, end.h, amount),
		s: lerp(start.s, end.s, amount),
		v: lerp(start.v, end.v, amount),
	};
}

function hsvToRgb(color: HsvColor) {
	const hue = ((color.h % 360) + 360) % 360;
	const saturation = clamp01(color.s / 100);
	const value = clamp01(color.v / 100);
	const chroma = value * saturation;
	const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
	const match = value - chroma;
	let red = 0;
	let green = 0;
	let blue = 0;

	if (hue < 60) [red, green, blue] = [chroma, x, 0];
	else if (hue < 120) [red, green, blue] = [x, chroma, 0];
	else if (hue < 180) [red, green, blue] = [0, chroma, x];
	else if (hue < 240) [red, green, blue] = [0, x, chroma];
	else if (hue < 300) [red, green, blue] = [x, 0, chroma];
	else [red, green, blue] = [chroma, 0, x];

	return {
		r: Math.round((red + match) * 255),
		g: Math.round((green + match) * 255),
		b: Math.round((blue + match) * 255),
	};
}

function colorString(color: HsvColor, alpha: number): string {
	const {r, g, b} = hsvToRgb(color);
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function visualVars(progress: number): LoopVisualVars {
	const amount = clamp01(progress);
	const color = mixHsv(INACTIVE, ACTIVE, amount);
	return {
		"--loop-region-fill": colorString(color, lerp(0.035, 0.11, amount)),
		"--loop-region-line": colorString(color, lerp(0.24, 0.78, amount)),
		"--loop-slider-fill": colorString(color, lerp(0.2, 1, amount)),
		"--loop-toggle-bg": colorString(color, lerp(0.02, 0.16, amount)),
		"--loop-toggle-border": colorString(color, lerp(0.22, 0.86, amount)),
		"--loop-toggle-color": colorString(color, lerp(0.62, 1, amount)),
	};
}

export function useLoopVisualTween(isActive: () => boolean) {
	const [progress, setProgress] = createSignal(isActive() ? 1 : 0);
	let frameId: number | undefined;

	createEffect(() => {
		const target = isActive() ? 1 : 0;
		const start = progress();
		let startTime: number | undefined;

		if (frameId !== undefined) window.cancelAnimationFrame(frameId);
		if (Math.abs(target - start) < 0.001) {
			setProgress(target);
			return;
		}

		const tick = (time: number) => {
			startTime ??= time;
			const elapsed = time - startTime;
			const amount = easeOutCubic(elapsed / TWEEN_MS);
			setProgress(lerp(start, target, amount));
			if (elapsed < TWEEN_MS) frameId = window.requestAnimationFrame(tick);
			else frameId = undefined;
		};

		frameId = window.requestAnimationFrame(tick);
	});

	onCleanup(() => {
		if (frameId !== undefined) window.cancelAnimationFrame(frameId);
	});

	return createMemo(() => visualVars(progress()));
}
