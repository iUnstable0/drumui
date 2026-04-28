import type {PlaybackControls} from "../types";
import {clamp} from "../utils/format";

export const MIN_SPEED = 0.25;
export const MAX_SPEED = 2;
export const MIN_LOOP_LENGTH_MS = 500;
const DEFAULT_BPM = 120;
const MIN_BPM = 40;

export function normalizeSpeed(speed: number): number {
	return clamp(speed, MIN_SPEED, MAX_SPEED);
}

export function originalMsToTransportSeconds(positionMs: number, speed: number): number {
	return Math.max(0, positionMs) / 1000 / normalizeSpeed(speed);
}

export function transportSecondsToOriginalMs(seconds: number, speed: number): number {
	return Math.max(0, seconds) * 1000 * normalizeSpeed(speed);
}

export interface TransportPositionClock {
	getSecondsAtTime(time: number): number;
}

export function playbackPositionMsAtAudioTime(transport: TransportPositionClock, audioTimeSeconds: number, speed: number, durationMs: number): number {
	return clamp(
		transportSecondsToOriginalMs(transport.getSecondsAtTime(audioTimeSeconds), speed),
		0,
		Math.max(0, durationMs),
	);
}

export function beatMsFromBpm(bpm: number): number {
	const normalizedBpm = Number.isFinite(bpm) ? Math.max(MIN_BPM, bpm) : DEFAULT_BPM;
	return 60_000 / normalizedBpm;
}

export function halfBeatMsFromBpm(bpm: number): number {
	return beatMsFromBpm(bpm) / 2;
}

export function beatEndMsAfter(positionMs: number, bpm: number): number {
	const beatMs = beatMsFromBpm(bpm);
	const position = Math.max(0, Number.isFinite(positionMs) ? positionMs : 0);
	return (Math.floor(position / beatMs) + 1) * beatMs;
}

export function loopMinLengthMsFromStep(stepMs: number): number {
	const step = Math.max(1, stepMs);
	return Math.ceil(MIN_LOOP_LENGTH_MS / step) * step;
}

export function snapMsToGrid(valueMs: number, stepMs: number): number {
	const step = Math.max(1, stepMs);
	return Math.round(Math.max(0, valueMs) / step) * step;
}

export function loopGridMaxMs(durationMs: number, bpm: number): number {
	const duration = Math.max(0, durationMs);
	const step = halfBeatMsFromBpm(bpm);
	return Math.floor(duration / step) * step;
}

export function snapLoopRangeToBeatGrid(durationMs: number, loopStartMs: number, loopEndMs: number, bpm: number) {
	const duration = Math.max(0, Number.isFinite(durationMs) ? durationMs : 0);
	const requestedStart = Number.isFinite(loopStartMs) ? loopStartMs : 0;
	const requestedEnd = Number.isFinite(loopEndMs) ? loopEndMs : duration;
	if (duration <= 0) return {startMs: 0, endMs: 0};
	if (requestedStart <= 0 && requestedEnd >= duration) return {startMs: 0, endMs: duration};

	const step = halfBeatMsFromBpm(bpm);
	const max = loopGridMaxMs(duration, bpm);
	const minLength = Math.min(max, loopMinLengthMsFromStep(step));

	if (max <= 0 || minLength <= 0) return {startMs: 0, endMs: duration};

	const start = clamp(snapMsToGrid(requestedStart, step), 0, Math.max(0, max - minLength));
	const end = clamp(snapMsToGrid(requestedEnd, step), start + minLength, max);
	return {startMs: start, endMs: end};
}

export function createDefaultLoopRange(durationMs: number, bpm: number, lastHitTimeMs?: number) {
	void bpm;
	void lastHitTimeMs;
	return {startMs: 0, endMs: Math.max(0, Number.isFinite(durationMs) ? durationMs : 0)};
}

export function sanitizeLoopRange(durationMs: number, loopStartMs: number, loopEndMs: number) {
	const duration = Math.max(0, durationMs);
	const start = clamp(loopStartMs, 0, Math.max(0, duration - MIN_LOOP_LENGTH_MS));
	const end = clamp(loopEndMs, start + MIN_LOOP_LENGTH_MS, duration);
	return {startMs: start, endMs: end};
}

export function shouldLoop(controls: PlaybackControls, durationMs: number): boolean {
	if (!controls.loopEnabled) return false;
	const loop = sanitizeLoopRange(durationMs, controls.loopStartMs, controls.loopEndMs);
	return loop.endMs - loop.startMs >= MIN_LOOP_LENGTH_MS;
}

export function linearToDb(value: number): number {
	if (value <= 0) return -60;
	return Math.max(-60, 20 * Math.log10(value));
}
