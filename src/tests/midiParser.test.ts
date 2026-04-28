import {Midi} from "@tonejs/midi";
import {describe, expect, it} from "vitest";
import {ANALOG_808_KIT} from "../kit/analog808";
import {parseMidiBytes} from "../midi/parseMidi";

describe("MIDI parsing", () => {
	it("normalizes MIDI notes into mapped drum hits", () => {
		const midi = new Midi();
		midi.header.setTempo(90);
		const track = midi.addTrack();
		track.name = "Drums";
		track.channel = 9;
		track.addNote({midi: 36, time: 0, duration: 0.1, velocity: 0.8});
		track.addNote({midi: 42, time: 0.5, duration: 0.1, velocity: 0.5});

		const parsed = parseMidiBytes(midi.toArray(), "beat.mid", ANALOG_808_KIT);

		expect(parsed.name).toBe("beat.mid");
		expect(parsed.bpm).toBeCloseTo(90);
		expect(parsed.hits.map((hit) => hit.pieceId)).toEqual(["kick", "closedHat"]);
		expect(parsed.hits[0].velocity).toBeCloseTo(0.8);
		expect(parsed.tracks[0]).toMatchObject({name: "Drums", noteCount: 2, mappedCount: 2});
	});

	it("reports unmapped notes without dropping mapped hits", () => {
		const midi = new Midi();
		const track = midi.addTrack();
		track.name = "Mixed";
		track.addNote({midi: 36, time: 0, duration: 0.1, velocity: 1});
		track.addNote({midi: 12, time: 0.25, duration: 0.1, velocity: 1});

		const parsed = parseMidiBytes(midi.toArray(), "mixed.mid", ANALOG_808_KIT);

		expect(parsed.hits).toHaveLength(1);
		expect(parsed.unmappedNotes).toHaveLength(1);
		expect(parsed.unmappedNotes[0]).toMatchObject({note: 12, count: 1});
	});

	it("extends duration to the beat after the final mapped hit", () => {
		const midi = new Midi();
		midi.header.setTempo(40);
		const track = midi.addTrack();
		track.addNote({midi: 36, time: 3, duration: 0.1, velocity: 1});

		const parsed = parseMidiBytes(midi.toArray(), "slow.mid", ANALOG_808_KIT);

		expect(parsed.durationMs).toBeCloseTo(4500);
	});
});
