import { describe, expect, it } from "vitest";
import {
	calculateAnchoredZoom,
	chooseTimelineGridIntervalMs,
	chooseTimelineTickIntervalMs,
	clampTimelineZoom,
	createTimelineGridLines,
	createTimelineScale,
	createTimelineTicks,
	dragTimelineLoopRange,
	formatBarsBeats,
	getTimelineContentWidth,
	getTimelineHitPreviewToleranceMs,
	getTimelinePreviewHits,
	MAX_TIMELINE_ZOOM,
	MIN_TIMELINE_ZOOM,
	TIMELINE_HIT_MARKER_WIDTH_PX,
	timeMsToX,
	xToTimeMs,
	zoomFromWheelDelta,
} from "../timelineMath";
import { formatTimecode } from "../utils/format";

describe("timeline math", () => {
	it("clamps zoom so the timeline never shrinks below the viewport", () => {
		expect(clampTimelineZoom(0.1)).toBe(MIN_TIMELINE_ZOOM);
		expect(clampTimelineZoom(0.5)).toBe(MIN_TIMELINE_ZOOM);
		expect(clampTimelineZoom(MIN_TIMELINE_ZOOM)).toBe(MIN_TIMELINE_ZOOM);
		expect(clampTimelineZoom(5)).toBe(5);
		expect(clampTimelineZoom(40)).toBe(MAX_TIMELINE_ZOOM);
		expect(clampTimelineZoom(Number.NaN)).toBe(1);
	});

	it("derives zoomed content width from the viewport", () => {
		expect(getTimelineContentWidth(10_000, 800, 1)).toBe(800);
		expect(getTimelineContentWidth(10_000, 800, 0.25)).toBe(800);
		expect(getTimelineContentWidth(10_000, 800, 2.5)).toBe(2000);
		expect(getTimelineContentWidth(10_000, 0, 1)).toBe(1);
	});

	it("round trips between timeline x positions and time through the shared scale", () => {
		const scale = createTimelineScale({
			durationMs: 32_000,
			bpm: 120,
			viewportWidth: 800,
			zoom: 4,
			scrollLeft: 500,
		});

		expect(scale.contentWidth).toBe(3200);
		expect(scale.pxPerBeat).toBeCloseTo(50);
		expect(timeMsToX(8000, scale.durationMs, scale.contentWidth)).toBe(800);
		expect(xToTimeMs(800, scale.durationMs, scale.contentWidth)).toBe(8000);
		expect(
			xToTimeMs(timeMsToX(23_500, scale.durationMs, scale.contentWidth), scale.durationMs, scale.contentWidth),
		).toBeCloseTo(23_500);
	});

	it("keeps the cursor anchored when zooming", () => {
		const result = calculateAnchoredZoom({
			currentZoom: 2,
			nextZoom: 4,
			durationMs: 20_000,
			viewportWidth: 1000,
			scrollLeft: 500,
			anchorX: 250,
		});

		expect(result.zoom).toBe(4);
		expect(result.contentWidth).toBe(4000);
		expect(result.anchoredTimeMs).toBeCloseTo(7500);
		expect(result.scrollLeft).toBeCloseTo(1250);
	});

	it("increases ruler and grid density as pxPerBeat grows", () => {
		const lowZoom = createTimelineScale({
			durationMs: 120_000,
			bpm: 120,
			viewportWidth: 800,
			zoom: 0.5,
			scrollLeft: 0,
			overscanPx: 0,
		});
		const highZoom = createTimelineScale({
			durationMs: 120_000,
			bpm: 120,
			viewportWidth: 800,
			zoom: 8,
			scrollLeft: 0,
			overscanPx: 0,
		});

		expect(chooseTimelineTickIntervalMs(highZoom)).toBeLessThan(chooseTimelineTickIntervalMs(lowZoom));
		expect(chooseTimelineGridIntervalMs(highZoom)).toBeLessThan(chooseTimelineGridIntervalMs(lowZoom));
		expect(createTimelineGridLines(lowZoom).every((line) => line.kind === "bar")).toBe(true);
		expect(createTimelineGridLines(highZoom).some((line) => line.kind === "beat")).toBe(true);
	});

	it("generates ticks from the visible range instead of the whole file", () => {
		const scale = createTimelineScale({
			durationMs: 60_000,
			bpm: 120,
			viewportWidth: 600,
			zoom: 8,
			scrollLeft: 2400,
			overscanPx: 0,
		});
		const ticks = createTimelineTicks(scale);

		expect(ticks.length).toBeGreaterThan(0);
		expect(ticks.every((tick) => tick.timeMs >= scale.visibleStartMs && tick.timeMs <= scale.visibleEndMs)).toBe(true);
		expect(ticks[0].timeMs).toBeGreaterThan(0);
	});

	it("keeps bar, beat, and time labels readable at low and high zoom", () => {
		const lowZoomTicks = createTimelineTicks(
			createTimelineScale({
				durationMs: 120_000,
				bpm: 120,
				viewportWidth: 800,
				zoom: 0.5,
				scrollLeft: 0,
				overscanPx: 0,
			}),
		);
		const highZoomTicks = createTimelineTicks(
			createTimelineScale({
				durationMs: 8000,
				bpm: 120,
				viewportWidth: 800,
				zoom: 4,
				scrollLeft: 0,
				overscanPx: 0,
			}),
		);

		expect(lowZoomTicks[0]).toMatchObject({ timeMs: 0, beatLabel: "1", timeLabel: "0:00.00", kind: "bar" });
		expect(lowZoomTicks[1]).toMatchObject({ timeMs: 16_000, beatLabel: "9", timeLabel: "0:16.00", kind: "bar" });
		expect(highZoomTicks[0]).toMatchObject({
			timeMs: 0,
			label: "1 · 0:00.00",
			beatLabel: "1",
			timeLabel: "0:00.00",
			kind: "bar",
		});
		expect(highZoomTicks[1]).toMatchObject({
			timeMs: 500,
			label: "1.2 · 0:00.50",
			beatLabel: "1.2",
			timeLabel: "0:00.50",
			kind: "beat",
		});
	});

	it("uses the visible hit marker width for hover-preview tolerance", () => {
		const durationMs = 10_000;
		const contentWidth = 1000;

		expect(getTimelineHitPreviewToleranceMs(durationMs, contentWidth)).toBeCloseTo(25);
		expect(getTimelineHitPreviewToleranceMs(durationMs, contentWidth * 2)).toBeCloseTo(12.5);
		expect(getTimelineHitPreviewToleranceMs(durationMs * 2, contentWidth)).toBeCloseTo(50);
		expect(getTimelineHitPreviewToleranceMs(durationMs, contentWidth, TIMELINE_HIT_MARKER_WIDTH_PX * 2)).toBeCloseTo(
			50,
		);
	});

	it("selects hits whose visible markers intersect the hovered time", () => {
		const hits = [
			{ id: "exact", timeMs: 1000 },
			{ id: "inside", timeMs: 1025 },
			{ id: "outside", timeMs: 1030 },
		];

		expect(getTimelinePreviewHits(hits, 1000, 10_000, 1000).map((hit) => hit.id)).toEqual(["exact", "inside"]);
	});

	it("moves loop ranges by snapped musical deltas while preserving length", () => {
		expect(
			dragTimelineLoopRange({
				mode: "move",
				originStartMs: 1000,
				originEndMs: 3000,
				originPointerMs: 1000,
				pointerMs: 1500,
				durationMs: 10_000,
				bpm: 120,
			}),
		).toEqual({ startMs: 1500, endMs: 3500 });

		expect(
			dragTimelineLoopRange({
				mode: "move",
				originStartMs: 8000,
				originEndMs: 9500,
				originPointerMs: 1000,
				pointerMs: 5000,
				durationMs: 10_000,
				bpm: 120,
			}),
		).toEqual({ startMs: 8500, endMs: 10_000 });
	});

	it("clamps loop handles to snapped min length and duration", () => {
		expect(
			dragTimelineLoopRange({
				mode: "start",
				originStartMs: 1000,
				originEndMs: 3000,
				originPointerMs: 1000,
				pointerMs: 2800,
				durationMs: 10_000,
				bpm: 120,
			}),
		).toEqual({ startMs: 2500, endMs: 3000 });

		expect(
			dragTimelineLoopRange({
				mode: "end",
				originStartMs: 1000,
				originEndMs: 3000,
				originPointerMs: 1000,
				pointerMs: 1200,
				durationMs: 10_000,
				bpm: 120,
			}),
		).toEqual({ startMs: 1000, endMs: 1500 });

		expect(
			dragTimelineLoopRange({
				mode: "end",
				originStartMs: 1000,
				originEndMs: 3000,
				originPointerMs: 1000,
				pointerMs: 9900,
				durationMs: 10_000,
				bpm: 120,
			}),
		).toEqual({ startMs: 1000, endMs: 10_000 });
	});

	describe("zoomFromWheelDelta", () => {
		it("zooms out for positive deltaY and in for negative deltaY", () => {
			expect(zoomFromWheelDelta(4, 100)).toBeLessThan(4);
			expect(zoomFromWheelDelta(4, -100)).toBeGreaterThan(4);
		});

		it("returns the same zoom when deltaY is zero", () => {
			expect(zoomFromWheelDelta(3, 0)).toBeCloseTo(3);
		});

		it("produces sub-1% changes for trackpad-sized deltas", () => {
			const baseline = 4;
			const next = zoomFromWheelDelta(baseline, 1);
			expect(Math.abs(next - baseline) / baseline).toBeLessThan(0.005);
		});

		it("clamps the result to the supported zoom range", () => {
			expect(zoomFromWheelDelta(MAX_TIMELINE_ZOOM, -1000)).toBe(MAX_TIMELINE_ZOOM);
			expect(zoomFromWheelDelta(MIN_TIMELINE_ZOOM, 1000)).toBe(MIN_TIMELINE_ZOOM);
		});
	});

	describe("formatBarsBeats", () => {
		it("starts at 1.1.1 at time zero", () => {
			expect(formatBarsBeats(0, 120)).toBe("1.1.1");
		});

		it("advances beats within a bar", () => {
			// 120 BPM → 500ms per beat
			expect(formatBarsBeats(500, 120)).toBe("1.2.1");
			expect(formatBarsBeats(1000, 120)).toBe("1.3.1");
			expect(formatBarsBeats(1500, 120)).toBe("1.4.1");
		});

		it("rolls over to the next bar after four beats", () => {
			expect(formatBarsBeats(2000, 120)).toBe("2.1.1");
			expect(formatBarsBeats(4000, 120)).toBe("3.1.1");
		});

		it("reports 16th-note sub-beat ticks", () => {
			expect(formatBarsBeats(125, 120)).toBe("1.1.2");
			expect(formatBarsBeats(250, 120)).toBe("1.1.3");
			expect(formatBarsBeats(375, 120)).toBe("1.1.4");
		});
	});
});

describe("formatTimecode", () => {
	it("formats with two-digit centiseconds", () => {
		expect(formatTimecode(0)).toBe("0:00.00");
		expect(formatTimecode(50)).toBe("0:00.05");
		expect(formatTimecode(1234)).toBe("0:01.23");
		expect(formatTimecode(61_500)).toBe("1:01.50");
		expect(formatTimecode(3_660_990)).toBe("61:00.99");
	});

	it("treats non-finite or negative input as zero", () => {
		expect(formatTimecode(Number.NaN)).toBe("0:00.00");
		expect(formatTimecode(-500)).toBe("0:00.00");
	});
});
