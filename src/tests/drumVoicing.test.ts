import {describe, expect, it} from "vitest";
import {getCanonicalSamplerNote, getChokeTargets, normalizeHitVelocity, velocityToGain} from "../audio/drumVoicing";
import {ANALOG_808_KIT} from "../kit/analog808";

describe("drum playback voicing", () => {
	it("clamps MIDI velocity into the audio normal range", () => {
		expect(normalizeHitVelocity(-0.2)).toBe(0);
		expect(normalizeHitVelocity(0.42)).toBe(0.42);
		expect(normalizeHitVelocity(1.4)).toBe(1);
		expect(normalizeHitVelocity(Number.NaN)).toBe(0);
	});

	it("uses exact velocity as the playback gain scalar", () => {
		expect(velocityToGain(0)).toBe(0);
		expect(velocityToGain(0.5)).toBe(0.5);
		expect(velocityToGain(1)).toBe(1);
	});

	it("resolves canonical sampler notes from kit MIDI mappings", () => {
		const kick = ANALOG_808_KIT.pieces.find((piece) => piece.id === "kick");
		const closedHat = ANALOG_808_KIT.pieces.find((piece) => piece.id === "closedHat");

		expect(kick && getCanonicalSamplerNote(kick)).toBe("B1");
		expect(closedHat && getCanonicalSamplerNote(closedHat)).toBe("A#0");
	});

	it("chokes open hats from closed hat hits only", () => {
		expect(getChokeTargets("closedHat")).toEqual(["openHat"]);
		expect(getChokeTargets("openHat")).toEqual([]);
		expect(getChokeTargets("kick")).toEqual([]);
	});
});
