import {describe, expect, it} from "vitest";
import {createLightEvent} from "../hardware/transport";
import {ANALOG_808_KIT} from "../kit/analog808";
import type {MidiHit} from "../types";

describe("light event generation", () => {
	it("turns a scheduled MIDI hit into a backend-ready preview event", () => {
		const hit: MidiHit = {
			id: "hit-1",
			tick: 0,
			timeMs: 250,
			durationMs: 80,
			note: 36,
			noteName: "C2",
			velocity: 0.75,
			channel: 9,
			pieceId: "kick",
			trackIndex: 0,
			trackName: "Drums",
		};

		const event = createLightEvent(hit, ANALOG_808_KIT);

		expect(event).toMatchObject({
			atMs: 250,
			pieceId: "kick",
			note: 36,
			velocity: 0.75,
		});
		expect(event.intensity).toBeCloseTo(0.75);
		expect(event.durationMs).toBeGreaterThan(0);
		expect(event.color).toBe(ANALOG_808_KIT.pieces[0].color);
	});
});
