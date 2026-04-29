import { describe, expect, it } from "vitest";
import {
	ANALOG_808_KIT,
	createDefaultLaneState,
	createLaneStatusMap,
	getLaneStatus,
	isLaneAudible,
	mapMidiNoteToPiece,
} from "../kit/analog808";
import { KIT_PIECE_IDS } from "../types";

describe("analog 808 kit mapping", () => {
	it("maps common General MIDI drum notes to the kit", () => {
		expect(mapMidiNoteToPiece(36)).toBe("kick");
		expect(mapMidiNoteToPiece(38)).toBe("snare");
		expect(mapMidiNoteToPiece(39)).toBe("clap");
		expect(mapMidiNoteToPiece(42)).toBe("closedHat");
		expect(mapMidiNoteToPiece(46)).toBe("openHat");
		expect(mapMidiNoteToPiece(43)).toBe("lowTom");
		expect(mapMidiNoteToPiece(45)).toBe("midTom");
		expect(mapMidiNoteToPiece(49)).toBe("crash");
		expect(mapMidiNoteToPiece(51)).toBe("ride");
	});

	it("keeps lane state complete for every kit piece", () => {
		const states = createDefaultLaneState();
		expect(Object.keys(states)).toHaveLength(ANALOG_808_KIT.pieces.length);
		for (const id of KIT_PIECE_IDS) {
			expect(states[id]).toMatchObject({ volume: 0.9, muted: false, soloed: false });
		}
	});

	it("reports muted, silent, and solo-excluded lane status reasons", () => {
		const states = createDefaultLaneState();
		states.kick.muted = true;
		states.snare.volume = 0;
		states.clap.soloed = true;

		const statuses = createLaneStatusMap(states);
		expect(isLaneAudible("clap", states)).toBe(true);
		expect(getLaneStatus("clap", states)).toEqual({ audible: true, reason: "audible" });
		expect(statuses.clap).toEqual({ audible: true, reason: "audible" });
		expect(statuses.kick).toEqual({ audible: false, reason: "muted" });
		expect(statuses.snare).toEqual({ audible: false, reason: "silent" });
		expect(statuses.closedHat).toEqual({ audible: false, reason: "solo-excluded" });
	});
});
