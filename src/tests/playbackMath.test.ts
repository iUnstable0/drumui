import { describe, expect, it } from "vitest";
import {
	beatEndMsAfter,
	createDefaultLoopRange,
	halfBeatMsFromBpm,
	linearToDb,
	loopMinLengthMsFromStep,
	normalizeSpeed,
	originalMsToTransportSeconds,
	playbackPositionMsAtAudioTime,
	sanitizeLoopRange,
	shouldLoop,
	snapLoopRangeToBeatGrid,
	snapMsToGrid,
	transportSecondsToOriginalMs,
} from "../audio/playbackMath";

describe("playback math", () => {
	it("scales original MIDI time into transport seconds", () => {
		expect(originalMsToTransportSeconds(4000, 2)).toBe(2);
		expect(transportSecondsToOriginalMs(2, 0.5)).toBe(1000);
	});

	it("derives playback position from the audible audio time", () => {
		const transport = {
			getSecondsAtTime: (time: number) => time - 0.1,
		};

		expect(playbackPositionMsAtAudioTime(transport, 1.1, 1, 3000)).toBeCloseTo(1000);
		expect(playbackPositionMsAtAudioTime(transport, 5, 1, 3000)).toBe(3000);
		expect(playbackPositionMsAtAudioTime(transport, 0.05, 1, 3000)).toBe(0);
	});

	it("clamps speed to the supported practice range", () => {
		expect(normalizeSpeed(0.1)).toBe(0.25);
		expect(normalizeSpeed(3)).toBe(2);
		expect(normalizeSpeed(1.25)).toBe(1.25);
	});

	it("sanitizes loop ranges to a usable minimum span", () => {
		expect(sanitizeLoopRange(10_000, -100, 120)).toEqual({ startMs: 0, endMs: 500 });
		expect(sanitizeLoopRange(10_000, 9800, 12_000)).toEqual({ startMs: 9500, endMs: 10000 });
	});

	it("snaps loop ranges to half-beat increments", () => {
		expect(halfBeatMsFromBpm(120)).toBe(250);
		expect(snapMsToGrid(370, 250)).toBe(250);
		expect(loopMinLengthMsFromStep(333)).toBe(666);
		expect(snapLoopRangeToBeatGrid(10_000, 120, 490, 120)).toEqual({ startMs: 0, endMs: 500 });
		expect(snapLoopRangeToBeatGrid(10_100, 9700, 10_100, 120)).toEqual({ startMs: 9500, endMs: 10000 });
	});

	it("defaults the loop to the full parsed duration", () => {
		expect(beatEndMsAfter(18_000, 120)).toBe(18_500);
		expect(createDefaultLoopRange(20_123, 120, 18_000)).toEqual({ startMs: 0, endMs: 20_123 });
	});

	it("defaults short tracks to the full parsed duration", () => {
		expect(createDefaultLoopRange(3000, 120, 1500)).toEqual({ startMs: 0, endMs: 3000 });
	});

	it("preserves full-duration loop ends even when duration is off grid", () => {
		expect(snapLoopRangeToBeatGrid(10_123, 0, 10_123, 120)).toEqual({ startMs: 0, endMs: 10_123 });
		expect(snapLoopRangeToBeatGrid(10_123, 0, 12_000, 120)).toEqual({ startMs: 0, endMs: 10_123 });
	});

	it("continues snapping manually edited non-full loop ranges", () => {
		expect(snapLoopRangeToBeatGrid(10_123, 1000, 10_123, 120)).toEqual({ startMs: 1000, endMs: 10_000 });
	});

	it("requires loop mode and a valid range before looping", () => {
		expect(
			shouldLoop(
				{
					speed: 1,
					loopEnabled: false,
					loopStartMs: 0,
					loopEndMs: 2000,
					countInEnabled: false,
					metronomeEnabled: false,
					masterVolume: 1,
				},
				4000,
			),
		).toBe(false);
		expect(
			shouldLoop(
				{
					speed: 1,
					loopEnabled: true,
					loopStartMs: 0,
					loopEndMs: 2000,
					countInEnabled: false,
					metronomeEnabled: false,
					masterVolume: 1,
				},
				4000,
			),
		).toBe(true);
	});

	it("converts linear gain to useful decibels", () => {
		expect(linearToDb(1)).toBe(0);
		expect(linearToDb(0)).toBe(-60);
		expect(linearToDb(0.5)).toBeCloseTo(-6.02, 1);
	});
});
