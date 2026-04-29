import * as Slider from "@kobalte/core/slider";
import { Maximize2, ZoomIn, ZoomOut } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { normalizeHitVelocity } from "../audio/drumVoicing";
import { snapLoopRangeToBeatGrid } from "../audio/playbackMath";
import type { TimelineLoopDragMode } from "../timelineMath";
import {
	calculateAnchoredZoom,
	clampTimelineScroll,
	createTimelineGridLines,
	createTimelineScale,
	createTimelineTicks,
	createZoomVelocityState,
	DEFAULT_TIMELINE_ZOOM,
	dragTimelineLoopRange,
	formatBarsBeats,
	getFollowScrollLeft,
	getTimelineLoopMinLengthMs,
	getTimelinePreviewHits,
	getZoomVelocityMultiplier,
	MAX_TIMELINE_ZOOM,
	MIN_TIMELINE_ZOOM,
	TIMELINE_ZOOM_STEP,
	timeMsToX,
	xToTimeMs,
	zoomFromWheelDelta,
} from "../timelineMath";
import type { DrumKit, KitPieceId, LaneStatusMap, MidiHit, ParsedMidi, PlaybackControls } from "../types";
import { clamp, formatPercent, formatTimecode } from "../utils/format";

interface TimelineProps {
	session: ParsedMidi;
	kit: DrumKit;
	positionMs: number;
	laneStatuses: LaneStatusMap;
	activePieceId: KitPieceId;
	controls: PlaybackControls;
	onSeek: (positionMs: number) => void;
	onLoopChange: (startMs: number, endMs: number) => void;
	onLoopEnabledChange: (enabled: boolean) => void;
	onFocusLane: (pieceId: KitPieceId) => void;
	onPointerLane: (pieceId: KitPieceId) => void;
	onPreviewHits: (hits: MidiHit[]) => void;
	onClearPreview: () => void;
	onAuditionLane: (pieceId: KitPieceId) => void;
}

interface LoopDragState {
	mode: TimelineLoopDragMode;
	pointerId: number;
	originPointerMs: number;
	originStartMs: number;
	originEndMs: number;
}

export function Timeline(props: TimelineProps) {
	let scrollHost!: HTMLDivElement;
	let labelColumn!: HTMLDivElement;
	let viewport!: HTMLDivElement;
	let loopDrag: LoopDragState | null = null;
	const [hoverX, setHoverX] = createSignal<number | null>(null);
	const [previewHitIds, setPreviewHitIds] = createSignal<Set<string>>(new Set());
	const [zoom, setZoom] = createSignal(DEFAULT_TIMELINE_ZOOM);
	const [timeViewportWidth, setTimeViewportWidth] = createSignal(1);
	const [scrollLeft, setScrollLeft] = createSignal(0);
	const [loopDragMode, setLoopDragMode] = createSignal<TimelineLoopDragMode | null>(null);
	const durationMs = createMemo(() => Math.max(1, props.session.durationMs));
	const scale = createMemo(() =>
		createTimelineScale({
			durationMs: durationMs(),
			bpm: props.session.bpm,
			viewportWidth: timeViewportWidth(),
			zoom: zoom(),
			scrollLeft: scrollLeft(),
		}),
	);
	const contentWidth = createMemo(() => scale().contentWidth);
	const loopRange = createMemo(() =>
		snapLoopRangeToBeatGrid(
			props.session.durationMs,
			props.controls.loopStartMs,
			props.controls.loopEndMs,
			props.session.bpm,
		),
	);
	const loopStartX = createMemo(() => timeMsToX(loopRange().startMs, durationMs(), contentWidth()));
	const loopEndX = createMemo(() => timeMsToX(loopRange().endMs, durationMs(), contentWidth()));
	const loopWidth = createMemo(() => Math.max(0, loopEndX() - loopStartX()));
	const playheadX = createMemo(() => timeMsToX(props.positionMs, durationMs(), contentWidth()));
	const rulerTicks = createMemo(() => createTimelineTicks(scale()));
	const gridLines = createMemo(() => createTimelineGridLines(scale()));
	const zoomPercent = createMemo(() => formatPercent(zoom()));
	const hoverTimeMs = createMemo(() => {
		const x = hoverX();
		return x === null ? 0 : xToTimeMs(x, durationMs(), contentWidth());
	});
	const loopLengthMs = createMemo(() => Math.max(0, loopRange().endMs - loopRange().startMs));
	const loopRangeTitle = createMemo(
		() =>
			`Loop · ${formatBarsBeats(loopLengthMs(), props.session.bpm)} (${formatTimecode(loopLengthMs())}) — right-click to disable, shift-drag the ruler to redraw`,
	);
	let followPausedUntil = 0;
	let programmaticScroll = false;
	let scrollReleaseFrame = 0;
	let previewKey = "";
	const zoomVelocity = createZoomVelocityState();

	onMount(() => {
		function updateTimeViewportWidth() {
			const labelWidth = labelColumn?.getBoundingClientRect().width ?? 86;
			const hostWidth = scrollHost?.clientWidth ?? 1;
			setTimeViewportWidth(Math.max(1, Math.floor(hostWidth - labelWidth)));
		}

		updateTimeViewportWidth();
		const observer = new ResizeObserver(updateTimeViewportWidth);
		observer.observe(scrollHost);
		observer.observe(labelColumn);
		onCleanup(() => observer.disconnect());
	});

	createEffect(() => {
		const nextScrollLeft = clampTimelineScroll(scrollLeft(), contentWidth(), timeViewportWidth());
		if (scrollHost && Math.abs(scrollHost.scrollLeft - nextScrollLeft) > 0.5) setTimelineScrollLeft(nextScrollLeft);
	});

	createEffect(() => {
		const nextScrollLeft = getFollowScrollLeft(
			props.positionMs,
			durationMs(),
			contentWidth(),
			timeViewportWidth(),
			scrollLeft(),
		);
		if (Date.now() > followPausedUntil && Math.abs(nextScrollLeft - scrollLeft()) > 0.5)
			setTimelineScrollLeft(nextScrollLeft);
	});

	onCleanup(() => {
		if (scrollReleaseFrame) window.cancelAnimationFrame(scrollReleaseFrame);
		props.onClearPreview();
	});

	function pauseAutoFollow() {
		followPausedUntil = Date.now() + 900;
	}

	function setTimelineScrollLeft(value: number) {
		if (!scrollHost) return;
		const nextScrollLeft = clampTimelineScroll(value, contentWidth(), timeViewportWidth());
		programmaticScroll = true;
		scrollHost.scrollLeft = nextScrollLeft;
		setScrollLeft(nextScrollLeft);
		if (scrollReleaseFrame) window.cancelAnimationFrame(scrollReleaseFrame);
		scrollReleaseFrame = window.requestAnimationFrame(() => {
			programmaticScroll = false;
			scrollReleaseFrame = 0;
		});
	}

	function xFromPointer(clientX: number) {
		const rect = viewport.getBoundingClientRect();
		return clamp(clientX - rect.left, 0, contentWidth());
	}

	function timeFromPointer(clientX: number) {
		return xToTimeMs(xFromPointer(clientX), durationMs(), contentWidth());
	}

	function clearPreviewHits() {
		if (!previewKey) return;
		previewKey = "";
		setPreviewHitIds(new Set<string>());
		props.onClearPreview();
	}

	function setPreviewHits(hits: MidiHit[]) {
		const nextKey = hits.map((hit) => hit.id).join("|");
		if (nextKey === previewKey) return;
		previewKey = nextKey;
		setPreviewHitIds(new Set(hits.map((hit) => hit.id)));
		if (hits.length > 0) props.onPreviewHits(hits);
		else props.onClearPreview();
	}

	function updatePreviewFromTime(hoverTimeMs: number) {
		const audibleHits = props.session.hits.filter((hit) => props.laneStatuses[hit.pieceId].audible);
		setPreviewHits(getTimelinePreviewHits(audibleHits, hoverTimeMs, durationMs(), contentWidth()));
	}

	function updateHoverFromPointer(clientX: number, previewHits = false) {
		const nextHoverX = xFromPointer(clientX);
		setHoverX(nextHoverX);
		if (previewHits) updatePreviewFromTime(xToTimeMs(nextHoverX, durationMs(), contentWidth()));
		else clearPreviewHits();
	}

	function clearHover() {
		setHoverX(null);
		clearPreviewHits();
	}

	function seekFromPointer(clientX: number) {
		props.onSeek(timeFromPointer(clientX));
	}

	function beginSeek(event: PointerEvent & { currentTarget: HTMLElement }, previewHits = false) {
		if (event.button !== 0) return;
		pauseAutoFollow();
		event.currentTarget.setPointerCapture(event.pointerId);
		updateHoverFromPointer(event.clientX, previewHits);
		seekFromPointer(event.clientX);
	}

	function moveSeek(event: PointerEvent & { currentTarget: HTMLElement }, previewHits = false) {
		updateHoverFromPointer(event.clientX, previewHits);
		if (event.currentTarget.hasPointerCapture(event.pointerId)) seekFromPointer(event.clientX);
	}

	function endSeek(event: PointerEvent & { currentTarget: HTMLElement }) {
		if (event.currentTarget.hasPointerCapture(event.pointerId))
			event.currentTarget.releasePointerCapture(event.pointerId);
	}

	function beginRulerLoopCreate(event: PointerEvent & { currentTarget: HTMLElement }) {
		if (event.button !== 0) return;
		event.preventDefault();
		pauseAutoFollow();
		clearPreviewHits();
		event.currentTarget.setPointerCapture(event.pointerId);
		const clickMs = timeFromPointer(event.clientX);
		const minLengthMs = getTimelineLoopMinLengthMs(props.session.durationMs, props.session.bpm);
		const startMs = clamp(clickMs, 0, Math.max(0, props.session.durationMs - minLengthMs));
		const endMs = Math.min(props.session.durationMs, startMs + minLengthMs);
		props.onLoopChange(startMs, endMs);
		if (!props.controls.loopEnabled) props.onLoopEnabledChange(true);
		loopDrag = {
			mode: "end",
			pointerId: event.pointerId,
			originPointerMs: clickMs,
			originStartMs: startMs,
			originEndMs: endMs,
		};
		setLoopDragMode("end");
		updateHoverFromPointer(event.clientX, false);
	}

	function beginLoopDrag(event: PointerEvent & { currentTarget: HTMLElement }, mode: TimelineLoopDragMode) {
		if (event.button !== 0) return;
		event.preventDefault();
		event.stopPropagation();
		pauseAutoFollow();
		clearPreviewHits();
		event.currentTarget.setPointerCapture(event.pointerId);
		const range = loopRange();
		loopDrag = {
			mode,
			pointerId: event.pointerId,
			originPointerMs: timeFromPointer(event.clientX),
			originStartMs: range.startMs,
			originEndMs: range.endMs,
		};
		setLoopDragMode(mode);
	}

	function moveLoopDrag(event: PointerEvent & { currentTarget: HTMLElement }) {
		if (!loopDrag || loopDrag.pointerId !== event.pointerId || !event.currentTarget.hasPointerCapture(event.pointerId))
			return;
		event.preventDefault();
		event.stopPropagation();
		const next = dragTimelineLoopRange({
			mode: loopDrag.mode,
			originStartMs: loopDrag.originStartMs,
			originEndMs: loopDrag.originEndMs,
			originPointerMs: loopDrag.originPointerMs,
			pointerMs: timeFromPointer(event.clientX),
			durationMs: props.session.durationMs,
			bpm: props.session.bpm,
		});
		props.onLoopChange(next.startMs, next.endMs);
	}

	function endLoopDrag(event: PointerEvent & { currentTarget: HTMLElement }) {
		if (loopDrag && loopDrag.pointerId === event.pointerId && event.currentTarget.hasPointerCapture(event.pointerId)) {
			event.currentTarget.releasePointerCapture(event.pointerId);
		}
		loopDrag = null;
		setLoopDragMode(null);
	}

	function applyZoom(nextZoom: number, anchorX = timeViewportWidth() / 2) {
		pauseAutoFollow();
		const result = calculateAnchoredZoom({
			currentZoom: zoom(),
			nextZoom,
			durationMs: durationMs(),
			viewportWidth: timeViewportWidth(),
			scrollLeft: scrollHost?.scrollLeft ?? scrollLeft(),
			anchorX,
		});
		setZoom(result.zoom);
		if (scrollHost) void scrollHost.offsetWidth;
		setTimelineScrollLeft(result.scrollLeft);
	}

	function fitTimeline() {
		pauseAutoFollow();
		setZoom(DEFAULT_TIMELINE_ZOOM);
		if (scrollHost) void scrollHost.offsetWidth;
		setTimelineScrollLeft(0);
	}

	function handleWheel(event: WheelEvent) {
		if (!scrollHost) return;

		const hostRect = scrollHost.getBoundingClientRect();
		const labelWidth = labelColumn?.getBoundingClientRect().width ?? 0;
		const anchorX = clamp(event.clientX - hostRect.left - labelWidth, 0, timeViewportWidth());

		if (event.ctrlKey || event.metaKey) {
			event.preventDefault();
			const multiplier = getZoomVelocityMultiplier(zoomVelocity, performance.now());
			applyZoom(zoomFromWheelDelta(zoom(), event.deltaY * multiplier), anchorX);
			return;
		}

		const horizontalDelta =
			Math.abs(event.deltaX) > Math.abs(event.deltaY) || event.shiftKey ? event.deltaX || event.deltaY : 0;
		const canScrollVertically = scrollHost.scrollHeight > scrollHost.clientHeight + 1;

		if (horizontalDelta || !canScrollVertically) {
			event.preventDefault();
			pauseAutoFollow();
			setTimelineScrollLeft((scrollHost?.scrollLeft ?? scrollLeft()) + (horizontalDelta || event.deltaY));
			return;
		}

		pauseAutoFollow();
	}

	return (
		<section class="timeline-panel" aria-label="MIDI drum timeline">
			<div class="timeline-toolbar">
				<div class="timeline-toolbar__readout">
					<span class="timeline-toolbar__title">Timeline</span>
					<span class="timeline-toolbar__time" aria-label="Playback position">
						<strong>{formatTimecode(props.positionMs)}</strong>
						<span class="timeline-toolbar__time-sep">/</span>
						<span class="timeline-toolbar__time-total">{formatTimecode(durationMs())}</span>
					</span>
					<span class="timeline-toolbar__bars" aria-label="Bar and beat">
						{formatBarsBeats(props.positionMs, props.session.bpm)}
					</span>
					<span class="timeline-toolbar__bpm" aria-label="Tempo">
						{Math.round(props.session.bpm)} <small>BPM</small>
					</span>
				</div>
				<div class="timeline-zoom" aria-label="Timeline zoom controls">
					<button
						class="timeline-tool-button"
						aria-label="Zoom out"
						onClick={() => applyZoom(zoom() - TIMELINE_ZOOM_STEP)}
					>
						<ZoomOut />
					</button>
					<Slider.Root
						class="timeline-zoom-slider"
						value={[zoom()]}
						minValue={MIN_TIMELINE_ZOOM}
						maxValue={MAX_TIMELINE_ZOOM}
						step={0.01}
						getValueLabel={() => zoomPercent()}
						onChange={(values) => applyZoom(values[0] ?? zoom())}
					>
						<Slider.Track class="range-control__track">
							<Slider.Fill class="range-control__fill" />
							<Slider.Thumb class="range-control__thumb" aria-label="Timeline zoom">
								<Slider.Input />
							</Slider.Thumb>
						</Slider.Track>
					</Slider.Root>
					<span class="timeline-zoom__value">{zoomPercent()}</span>
					<button
						class="timeline-tool-button"
						aria-label="Zoom in"
						onClick={() => applyZoom(zoom() + TIMELINE_ZOOM_STEP)}
					>
						<ZoomIn />
					</button>
					<button class="timeline-tool-button" aria-label="Fit timeline (double-click ruler)" onClick={fitTimeline}>
						<Maximize2 />
					</button>
				</div>
			</div>

			<div
				ref={scrollHost}
				class="timeline-scroll"
				onScroll={() => {
					if (!programmaticScroll) pauseAutoFollow();
					setScrollLeft(scrollHost.scrollLeft);
				}}
				onWheel={handleWheel}
			>
				<div
					class="timeline"
					style={{
						"--lane-count": String(props.kit.pieces.length),
						"--timeline-content-width": `${contentWidth()}px`,
					}}
				>
					<div ref={labelColumn} class="timeline-corner">
						<span>Time</span>
					</div>
					<div
						class="timeline-ruler"
						onPointerDown={(event) => {
							if (event.button === 0 && event.shiftKey) {
								beginRulerLoopCreate(event);
								return;
							}
							beginSeek(event);
						}}
						onPointerMove={(event) => {
							if (loopDrag && loopDrag.pointerId === event.pointerId) {
								moveLoopDrag(event);
								return;
							}
							moveSeek(event);
						}}
						onPointerUp={(event) => {
							if (loopDrag && loopDrag.pointerId === event.pointerId) {
								endLoopDrag(event);
								return;
							}
							endSeek(event);
						}}
						onPointerCancel={(event) => {
							if (loopDrag && loopDrag.pointerId === event.pointerId) {
								endLoopDrag(event);
								return;
							}
							endSeek(event);
						}}
						onPointerLeave={(event) => {
							if (!event.currentTarget.hasPointerCapture(event.pointerId)) clearHover();
						}}
						onDblClick={fitTimeline}
					>
						<div class="timeline-ruler__ticks" aria-hidden="true">
							<For each={rulerTicks()}>
								{(tick) => (
									<div class={`timeline-ruler__tick is-${tick.kind}`} style={{ left: `${tick.x}px` }}>
										<strong>{tick.beatLabel}</strong>
										<small>{tick.timeLabel}</small>
									</div>
								)}
							</For>
						</div>
						<div class="timeline-loop-ruler-layer" aria-label="Loop region">
							<div
								class="timeline-loop-range"
								classList={{
									"is-active": props.controls.loopEnabled,
									"is-dragging": loopDragMode() === "move",
								}}
								role="button"
								tabIndex={0}
								title={loopRangeTitle()}
								aria-label={`Move loop region from ${formatTimecode(loopRange().startMs)} to ${formatTimecode(loopRange().endMs)} — right-click to disable looping`}
								style={{ left: `${loopStartX()}px`, width: `${loopWidth()}px` }}
								onPointerDown={(event) => beginLoopDrag(event, "move")}
								onPointerMove={moveLoopDrag}
								onPointerUp={endLoopDrag}
								onPointerCancel={endLoopDrag}
								onContextMenu={(event) => {
									event.preventDefault();
									event.stopPropagation();
									if (props.controls.loopEnabled) props.onLoopEnabledChange(false);
								}}
							/>
							<button
								type="button"
								class="timeline-loop-handle is-start"
								classList={{
									"is-active": props.controls.loopEnabled,
									"is-dragging": loopDragMode() === "start",
								}}
								aria-label="Adjust loop start"
								style={{ left: `${loopStartX()}px` }}
								onPointerDown={(event) => beginLoopDrag(event, "start")}
								onPointerMove={moveLoopDrag}
								onPointerUp={endLoopDrag}
								onPointerCancel={endLoopDrag}
							/>
							<button
								type="button"
								class="timeline-loop-handle is-end"
								classList={{
									"is-active": props.controls.loopEnabled,
									"is-dragging": loopDragMode() === "end",
								}}
								aria-label="Adjust loop end"
								style={{ left: `${loopEndX()}px` }}
								onPointerDown={(event) => beginLoopDrag(event, "end")}
								onPointerMove={moveLoopDrag}
								onPointerUp={endLoopDrag}
								onPointerCancel={endLoopDrag}
							/>
						</div>
					</div>
					<div class="timeline-labels">
						<For each={props.kit.pieces}>
							{(piece) => {
								const status = () => props.laneStatuses[piece.id];
								return (
									<button
										type="button"
										class="timeline-lane__label"
										classList={{
											"is-active-lane": props.activePieceId === piece.id,
											"is-lane-inactive": !status().audible,
											"is-lane-muted": status().reason === "muted",
											"is-lane-silent": status().reason === "silent",
											"is-lane-solo-excluded": status().reason === "solo-excluded",
										}}
										data-lane-status={status().reason}
										aria-disabled={!status().audible}
										onClick={() => {
											props.onFocusLane(piece.id);
											props.onAuditionLane(piece.id);
										}}
										onPointerEnter={() => props.onPointerLane(piece.id)}
										onPointerMove={() => props.onPointerLane(piece.id)}
									>
										{piece.label}
									</button>
								);
							}}
						</For>
					</div>
					<div
						ref={viewport}
						class="timeline-viewport"
						onPointerDown={(event) => beginSeek(event, true)}
						onPointerMove={(event) => moveSeek(event, true)}
						onPointerUp={endSeek}
						onPointerLeave={(event) => {
							if (!event.currentTarget.hasPointerCapture(event.pointerId)) clearHover();
						}}
						onPointerCancel={(event) => {
							endSeek(event);
							clearHover();
						}}
					>
						<div class="timeline-grid-lines" aria-hidden="true">
							<For each={gridLines()}>
								{(line) => <span class={`timeline-grid-line is-${line.kind}`} style={{ left: `${line.x}px` }} />}
							</For>
						</div>
						<div class="timeline-loop-body-layer" aria-hidden="true">
							<div
								class="timeline-loop-body-fill"
								classList={{ "is-active": props.controls.loopEnabled }}
								style={{ left: `${loopStartX()}px`, width: `${loopWidth()}px` }}
							/>
							<div
								class="timeline-loop-boundary is-start"
								classList={{ "is-active": props.controls.loopEnabled }}
								style={{ left: `${loopStartX()}px` }}
							/>
							<div
								class="timeline-loop-boundary is-end"
								classList={{ "is-active": props.controls.loopEnabled }}
								style={{ left: `${loopEndX()}px` }}
							/>
						</div>
						<Show when={hoverX() !== null}>
							<div class="timeline-hover-cursor" style={{ left: `${hoverX() ?? 0}px` }} aria-hidden="true" />
						</Show>
						<div class="playhead" style={{ left: `${playheadX()}px` }}>
							<span class="playhead__head" aria-hidden="true" />
						</div>
						<For each={props.kit.pieces}>
							{(piece) => {
								const status = () => props.laneStatuses[piece.id];
								return (
									<div
										class="timeline-hit-row"
										classList={{
											"is-active-lane": props.activePieceId === piece.id,
											"is-lane-inactive": !status().audible,
											"is-lane-muted": status().reason === "muted",
											"is-lane-silent": status().reason === "silent",
											"is-lane-solo-excluded": status().reason === "solo-excluded",
										}}
										data-lane-status={status().reason}
										style={{ "--piece-color": piece.color }}
									>
										<For each={props.session.hits.filter((hit) => hit.pieceId === piece.id)}>
											{(hit) => {
												const velocity = () => normalizeHitVelocity(hit.velocity);
												const height = () => 5 + velocity() * 19;
												return (
													<span
														class="timeline-hit"
														classList={{ "is-previewed": previewHitIds().has(hit.id) }}
														style={{
															left: `${timeMsToX(hit.timeMs, durationMs(), contentWidth())}px`,
															top: `calc(50% - ${height() / 2}px)`,
															bottom: "auto",
															height: `${height()}px`,
															opacity: String(Math.max(0.18, velocity())),
														}}
													/>
												);
											}}
										</For>
									</div>
								);
							}}
						</For>
					</div>
					<div class="timeline-hover-corner" aria-hidden="true" />
					<div class="timeline-hover-strip" aria-hidden="true">
						<Show when={hoverX() !== null}>
							<div class="timeline-hover-chip" style={{ left: `${hoverX() ?? 0}px` }}>
								<span
									class="timeline-hover-cursor__chip"
									classList={{
										"is-pinned-end": (hoverX() ?? 0) > contentWidth() - 80,
									}}
								>
									<strong>{formatBarsBeats(hoverTimeMs(), props.session.bpm)}</strong>
									<small>{formatTimecode(hoverTimeMs())}</small>
								</span>
							</div>
						</Show>
					</div>
				</div>
			</div>

			<Show when={props.session.unmappedNotes.length > 0}>
				<div class="unmapped-strip">
					<strong>{props.session.unmappedNotes.length}</strong>
					<span>unmapped MIDI notes are parked in the inspector.</span>
				</div>
			</Show>
		</section>
	);
}
