import { beatMsFromBpm, loopMinLengthMsFromStep } from "./audio/playbackMath";
import { clamp, formatTimecode } from "./utils/format";

export const MIN_TIMELINE_ZOOM = 1;
export const MAX_TIMELINE_ZOOM = 12;
export const DEFAULT_TIMELINE_ZOOM = 1;
export const TIMELINE_ZOOM_STEP = 0.35;
export const TIMELINE_ZOOM_WHEEL_SENSITIVITY = 0.0025;
export const TIMELINE_ZOOM_VELOCITY_TIMEOUT_MS = 250;
export const TIMELINE_ZOOM_VELOCITY_RAMP_MS = 600;
export const TIMELINE_ZOOM_VELOCITY_MAX_MULTIPLIER = 4;
export const TIMELINE_HIT_MARKER_WIDTH_PX = 5;
export const TIMELINE_BEATS_PER_BAR = 4;

const MIN_CONTENT_WIDTH = 1;
const MIN_LABEL_SPACING_PX = 96;
const GRID_MIN_SPACING_PX = 12;
const VISIBLE_OVERSCAN_PX = 160;
const BAR_MULTIPLIERS = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024] as const;

export type TimelineGridLineKind = "bar" | "beat" | "subbeat";
export type TimelineTickKind = "bar" | "beat";
export type TimelineLoopDragMode = "move" | "start" | "end";

export interface TimelineScaleInput {
	durationMs: number;
	bpm: number;
	viewportWidth: number;
	zoom: number;
	scrollLeft?: number;
	overscanPx?: number;
}

export interface TimelineScale {
	durationMs: number;
	bpm: number;
	beatMs: number;
	barMs: number;
	contentWidth: number;
	viewportWidth: number;
	scrollLeft: number;
	visibleStartMs: number;
	visibleEndMs: number;
	pxPerMs: number;
	pxPerBeat: number;
}

export interface TimelineTick {
	timeMs: number;
	x: number;
	label: string;
	beatLabel: string;
	timeLabel: string;
	kind: TimelineTickKind;
	bar: number;
	beat: number;
}

export interface TimelineGridLine {
	timeMs: number;
	x: number;
	kind: TimelineGridLineKind;
}

export interface AnchoredZoomInput {
	currentZoom: number;
	nextZoom: number;
	durationMs: number;
	viewportWidth: number;
	scrollLeft: number;
	anchorX: number;
}

export interface TimelinePreviewHitCandidate {
	timeMs: number;
}

export interface TimelineLoopDragInput {
	mode: TimelineLoopDragMode;
	originStartMs: number;
	originEndMs: number;
	originPointerMs: number;
	pointerMs: number;
	durationMs: number;
	bpm: number;
}

export interface TimelineLoopRange {
	startMs: number;
	endMs: number;
}

export function clampTimelineZoom(zoom: number): number {
	if (!Number.isFinite(zoom)) return DEFAULT_TIMELINE_ZOOM;
	return clamp(zoom, MIN_TIMELINE_ZOOM, MAX_TIMELINE_ZOOM);
}

export function getTimelineContentWidth(durationMs: number, viewportWidth: number, zoom: number): number {
	void durationMs;
	const safeViewportWidth = Math.max(
		MIN_CONTENT_WIDTH,
		Number.isFinite(viewportWidth) ? viewportWidth : MIN_CONTENT_WIDTH,
	);
	const width = safeViewportWidth * clampTimelineZoom(zoom);
	return Math.max(MIN_CONTENT_WIDTH, Math.ceil(width));
}

export function timeMsToX(timeMs: number, durationMs: number, contentWidth: number): number {
	const safeDuration = Math.max(1, Number.isFinite(durationMs) ? durationMs : 1);
	const safeWidth = Math.max(MIN_CONTENT_WIDTH, Number.isFinite(contentWidth) ? contentWidth : MIN_CONTENT_WIDTH);
	const safeTime = clamp(Number.isFinite(timeMs) ? timeMs : 0, 0, safeDuration);
	return (safeTime / safeDuration) * safeWidth;
}

export function xToTimeMs(x: number, durationMs: number, contentWidth: number): number {
	const safeDuration = Math.max(1, Number.isFinite(durationMs) ? durationMs : 1);
	const safeWidth = Math.max(MIN_CONTENT_WIDTH, Number.isFinite(contentWidth) ? contentWidth : MIN_CONTENT_WIDTH);
	const safeX = clamp(Number.isFinite(x) ? x : 0, 0, safeWidth);
	return (safeX / safeWidth) * safeDuration;
}

export function createTimelineScale(input: TimelineScaleInput): TimelineScale {
	const durationMs = Math.max(1, Number.isFinite(input.durationMs) ? input.durationMs : 1);
	const viewportWidth = Math.max(
		MIN_CONTENT_WIDTH,
		Number.isFinite(input.viewportWidth) ? input.viewportWidth : MIN_CONTENT_WIDTH,
	);
	const contentWidth = getTimelineContentWidth(durationMs, viewportWidth, input.zoom);
	const scrollLeft = clampTimelineScroll(input.scrollLeft ?? 0, contentWidth, viewportWidth);
	const overscanPx = Math.max(
		0,
		Number.isFinite(input.overscanPx) ? (input.overscanPx ?? VISIBLE_OVERSCAN_PX) : VISIBLE_OVERSCAN_PX,
	);
	const visibleStartMs = xToTimeMs(Math.max(0, scrollLeft - overscanPx), durationMs, contentWidth);
	const visibleEndMs = xToTimeMs(
		Math.min(contentWidth, scrollLeft + viewportWidth + overscanPx),
		durationMs,
		contentWidth,
	);
	const beatMs = beatMsFromBpm(input.bpm);
	const pxPerMs = contentWidth / durationMs;

	return {
		durationMs,
		bpm: input.bpm,
		beatMs,
		barMs: beatMs * TIMELINE_BEATS_PER_BAR,
		contentWidth,
		viewportWidth,
		scrollLeft,
		visibleStartMs,
		visibleEndMs,
		pxPerMs,
		pxPerBeat: beatMs * pxPerMs,
	};
}

export function getTimelineHitPreviewToleranceMs(
	durationMs: number,
	contentWidth: number,
	markerWidthPx = TIMELINE_HIT_MARKER_WIDTH_PX,
): number {
	const safeDuration = Math.max(1, Number.isFinite(durationMs) ? durationMs : 1);
	const safeWidth = Math.max(MIN_CONTENT_WIDTH, Number.isFinite(contentWidth) ? contentWidth : MIN_CONTENT_WIDTH);
	const safeMarkerWidth = Math.max(0, Number.isFinite(markerWidthPx) ? markerWidthPx : TIMELINE_HIT_MARKER_WIDTH_PX);
	return (safeMarkerWidth / 2 / safeWidth) * safeDuration;
}

export function getTimelinePreviewHits<T extends TimelinePreviewHitCandidate>(
	hits: readonly T[],
	hoverTimeMs: number,
	durationMs: number,
	contentWidth: number,
	markerWidthPx = TIMELINE_HIT_MARKER_WIDTH_PX,
): T[] {
	const safeDuration = Math.max(1, Number.isFinite(durationMs) ? durationMs : 1);
	const safeHoverTimeMs = clamp(Number.isFinite(hoverTimeMs) ? hoverTimeMs : 0, 0, safeDuration);
	const toleranceMs = getTimelineHitPreviewToleranceMs(safeDuration, contentWidth, markerWidthPx);
	return hits.filter((hit) => Math.abs(hit.timeMs - safeHoverTimeMs) <= toleranceMs);
}

export function clampTimelineScroll(scrollLeft: number, contentWidth: number, viewportWidth: number): number {
	const maxScroll = Math.max(0, contentWidth - Math.max(0, viewportWidth));
	return clamp(Number.isFinite(scrollLeft) ? scrollLeft : 0, 0, maxScroll);
}

export function zoomFromWheelDelta(currentZoom: number, deltaY: number): number {
	const safeZoom = Number.isFinite(currentZoom) ? currentZoom : DEFAULT_TIMELINE_ZOOM;
	const safeDelta = Number.isFinite(deltaY) ? deltaY : 0;
	const factor = Math.exp(-safeDelta * TIMELINE_ZOOM_WHEEL_SENSITIVITY);
	return clampTimelineZoom(safeZoom * factor);
}

export interface ZoomVelocityState {
	sessionStartMs: number;
	lastEventMs: number;
}

export function createZoomVelocityState(): ZoomVelocityState {
	return { sessionStartMs: 0, lastEventMs: 0 };
}

export function getZoomVelocityMultiplier(state: ZoomVelocityState, nowMs: number): number {
	if (!Number.isFinite(nowMs)) return 1;
	if (state.lastEventMs === 0 || nowMs - state.lastEventMs > TIMELINE_ZOOM_VELOCITY_TIMEOUT_MS) {
		state.sessionStartMs = nowMs;
	}
	state.lastEventMs = nowMs;
	const elapsed = Math.max(0, nowMs - state.sessionStartMs);
	const ramp = Math.min(1, elapsed / TIMELINE_ZOOM_VELOCITY_RAMP_MS);
	return 1 + (TIMELINE_ZOOM_VELOCITY_MAX_MULTIPLIER - 1) * ramp;
}

export function calculateAnchoredZoom(input: AnchoredZoomInput) {
	const currentZoom = clampTimelineZoom(input.currentZoom);
	const nextZoom = clampTimelineZoom(input.nextZoom);
	const oldContentWidth = getTimelineContentWidth(input.durationMs, input.viewportWidth, currentZoom);
	const anchorX = clamp(input.anchorX, 0, Math.max(0, input.viewportWidth));
	const anchoredTimeMs = xToTimeMs(input.scrollLeft + anchorX, input.durationMs, oldContentWidth);
	const contentWidth = getTimelineContentWidth(input.durationMs, input.viewportWidth, nextZoom);
	const nextScrollLeft = clampTimelineScroll(
		timeMsToX(anchoredTimeMs, input.durationMs, contentWidth) - anchorX,
		contentWidth,
		input.viewportWidth,
	);

	return {
		zoom: nextZoom,
		contentWidth,
		scrollLeft: nextScrollLeft,
		anchoredTimeMs,
	};
}

export function getFollowScrollLeft(
	timeMs: number,
	durationMs: number,
	contentWidth: number,
	viewportWidth: number,
	currentScrollLeft: number,
	edgePadding = 96,
): number {
	const safeViewportWidth = Math.max(0, viewportWidth);
	const maxScroll = Math.max(0, contentWidth - safeViewportWidth);
	if (maxScroll <= 0) return 0;

	const playheadX = timeMsToX(timeMs, durationMs, contentWidth);
	const leftEdge = currentScrollLeft + edgePadding;
	const rightEdge = currentScrollLeft + safeViewportWidth - edgePadding;

	if (playheadX < leftEdge) return clampTimelineScroll(playheadX - edgePadding, contentWidth, safeViewportWidth);
	if (playheadX > rightEdge)
		return clampTimelineScroll(playheadX - safeViewportWidth + edgePadding, contentWidth, safeViewportWidth);
	return clampTimelineScroll(currentScrollLeft, contentWidth, safeViewportWidth);
}

export function formatTimelineTimestamp(milliseconds: number): string {
	return formatTimecode(milliseconds);
}

export function barBeatFromTime(timeMs: number, bpm: number) {
	const beatMs = beatMsFromBpm(bpm);
	const beatIndex = Math.max(0, Math.round(Math.max(0, timeMs) / beatMs));
	const bar = Math.floor(beatIndex / TIMELINE_BEATS_PER_BAR) + 1;
	const beat = (beatIndex % TIMELINE_BEATS_PER_BAR) + 1;
	return { bar, beat, beatIndex };
}

export function formatBarsBeats(timeMs: number, bpm: number): string {
	const safeTimeMs = Math.max(0, Number.isFinite(timeMs) ? timeMs : 0);
	const beatMs = beatMsFromBpm(bpm);
	const beatIndex = Math.floor(safeTimeMs / beatMs);
	const bar = Math.floor(beatIndex / TIMELINE_BEATS_PER_BAR) + 1;
	const beat = (beatIndex % TIMELINE_BEATS_PER_BAR) + 1;
	const intoBeat = safeTimeMs - beatIndex * beatMs;
	const tick = Math.min(4, Math.floor((intoBeat / beatMs) * 4) + 1);
	return `${bar}.${beat}.${tick}`;
}

export function chooseTimelineTickIntervalMs(scale: TimelineScale, minLabelSpacingPx = MIN_LABEL_SPACING_PX): number {
	const barWidth = scale.pxPerBeat * TIMELINE_BEATS_PER_BAR;
	if (scale.pxPerBeat >= minLabelSpacingPx) return scale.beatMs;
	if (barWidth >= minLabelSpacingPx) return scale.barMs;
	const multiplier =
		BAR_MULTIPLIERS.find((value) => barWidth * value >= minLabelSpacingPx) ??
		BAR_MULTIPLIERS[BAR_MULTIPLIERS.length - 1];
	return scale.barMs * multiplier;
}

export function chooseTimelineGridIntervalMs(scale: TimelineScale): number {
	const barWidth = scale.pxPerBeat * TIMELINE_BEATS_PER_BAR;
	if (scale.pxPerBeat >= GRID_MIN_SPACING_PX * 8) return scale.beatMs / 4;
	if (scale.pxPerBeat >= GRID_MIN_SPACING_PX * 4) return scale.beatMs / 2;
	if (scale.pxPerBeat >= GRID_MIN_SPACING_PX) return scale.beatMs;
	if (barWidth >= GRID_MIN_SPACING_PX) return scale.barMs;
	const multiplier =
		BAR_MULTIPLIERS.find((value) => barWidth * value >= GRID_MIN_SPACING_PX) ??
		BAR_MULTIPLIERS[BAR_MULTIPLIERS.length - 1];
	return scale.barMs * multiplier;
}

export function createTimelineTicks(scale: TimelineScale, minLabelSpacingPx = MIN_LABEL_SPACING_PX): TimelineTick[] {
	const intervalMs = chooseTimelineTickIntervalMs(scale, minLabelSpacingPx);
	const ticks: TimelineTick[] = [];
	const startMs = Math.floor(scale.visibleStartMs / intervalMs) * intervalMs;

	for (let timeMs = startMs; timeMs <= scale.visibleEndMs + 0.01; timeMs += intervalMs) {
		const safeTimeMs = clamp(timeMs, 0, scale.durationMs);
		const { bar, beat } = barBeatFromTime(safeTimeMs, scale.bpm);
		const kind: TimelineTickKind = beat === 1 ? "bar" : "beat";
		const beatLabel = kind === "bar" ? `${bar}` : `${bar}.${beat}`;
		const timeLabel = formatTimelineTimestamp(safeTimeMs);

		if (ticks.some((tick) => Math.abs(tick.timeMs - safeTimeMs) < 0.01)) continue;
		ticks.push({
			timeMs: safeTimeMs,
			x: timeMsToX(safeTimeMs, scale.durationMs, scale.contentWidth),
			label: `${beatLabel} · ${timeLabel}`,
			beatLabel,
			timeLabel,
			kind,
			bar,
			beat,
		});
	}

	return ticks;
}

export function createTimelineGridLines(scale: TimelineScale): TimelineGridLine[] {
	const intervalMs = chooseTimelineGridIntervalMs(scale);
	const lines: TimelineGridLine[] = [];
	const startMs = Math.floor(scale.visibleStartMs / intervalMs) * intervalMs;

	for (let timeMs = startMs; timeMs <= scale.visibleEndMs + 0.01; timeMs += intervalMs) {
		const safeTimeMs = clamp(timeMs, 0, scale.durationMs);
		const beatIndex = Math.round(safeTimeMs / scale.beatMs);
		const isBeat = Math.abs(safeTimeMs - beatIndex * scale.beatMs) < 0.01;
		const kind: TimelineGridLineKind = isBeat ? (beatIndex % TIMELINE_BEATS_PER_BAR === 0 ? "bar" : "beat") : "subbeat";

		if (lines.some((line) => Math.abs(line.timeMs - safeTimeMs) < 0.01)) continue;
		lines.push({
			timeMs: safeTimeMs,
			x: timeMsToX(safeTimeMs, scale.durationMs, scale.contentWidth),
			kind,
		});
	}

	return lines;
}

export function getTimelineLoopStepMs(bpm: number): number {
	return beatMsFromBpm(bpm) / 4;
}

export function getTimelineLoopMinLengthMs(durationMs: number, bpm: number): number {
	const duration = Math.max(0, Number.isFinite(durationMs) ? durationMs : 0);
	if (duration <= 0) return 0;
	return Math.min(duration, loopMinLengthMsFromStep(getTimelineLoopStepMs(bpm)));
}

function snapSignedMs(valueMs: number, stepMs: number): number {
	const step = Math.max(1, stepMs);
	return Math.round(valueMs / step) * step;
}

function snapLoopBoundaryMs(valueMs: number, durationMs: number, stepMs: number, endSnapToleranceMs: number): number {
	if (valueMs >= durationMs - endSnapToleranceMs) return durationMs;
	return clamp(snapSignedMs(valueMs, stepMs), 0, durationMs);
}

export function dragTimelineLoopRange(input: TimelineLoopDragInput): TimelineLoopRange {
	const durationMs = Math.max(0, Number.isFinite(input.durationMs) ? input.durationMs : 0);
	if (durationMs <= 0) return { startMs: 0, endMs: 0 };

	const stepMs = getTimelineLoopStepMs(input.bpm);
	const endSnapToleranceMs = beatMsFromBpm(input.bpm) / 2;
	const minLengthMs = getTimelineLoopMinLengthMs(durationMs, input.bpm);
	const originStartMs = clamp(input.originStartMs, 0, durationMs);
	const originEndMs = clamp(input.originEndMs, originStartMs, durationMs);
	const originLengthMs = Math.max(minLengthMs, originEndMs - originStartMs);

	if (input.mode === "move") {
		const deltaMs = snapSignedMs(input.pointerMs - input.originPointerMs, stepMs);
		const startMs = clamp(snapSignedMs(originStartMs + deltaMs, stepMs), 0, Math.max(0, durationMs - originLengthMs));
		return { startMs, endMs: Math.min(durationMs, startMs + originLengthMs) };
	}

	if (input.mode === "start") {
		const endMs = clamp(originEndMs, minLengthMs, durationMs);
		const startMs = clamp(
			snapLoopBoundaryMs(input.pointerMs, durationMs, stepMs, endSnapToleranceMs),
			0,
			Math.max(0, endMs - minLengthMs),
		);
		return { startMs, endMs };
	}

	const startMs = clamp(originStartMs, 0, Math.max(0, durationMs - minLengthMs));
	const endMs = clamp(
		snapLoopBoundaryMs(input.pointerMs, durationMs, stepMs, endSnapToleranceMs),
		startMs + minLengthMs,
		durationMs,
	);
	return { startMs, endMs };
}
