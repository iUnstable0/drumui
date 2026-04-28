import {Midi} from "@tonejs/midi";
import type {DrumKit, MidiHit, MidiTrackSummary, ParsedMidi, UnmappedMidiNote} from "../types";
import {mapMidiNoteToPiece} from "../kit/analog808";
import {beatEndMsAfter} from "../audio/playbackMath";
import {basename, noteNameFromMidi} from "../utils/format";

export function parseMidiBytes(bytes: Uint8Array, label: string, kit: DrumKit): ParsedMidi {
	const midi = new Midi(bytes);
	const unmapped = new Map<string, UnmappedMidiNote>();
	const kitPieceIds = new Set(kit.pieces.map((piece) => piece.id));
	const tracks: MidiTrackSummary[] = [];
	const hits: MidiHit[] = [];

	midi.tracks.forEach((track, trackIndex) => {
		let mappedCount = 0;
		const trackName = track.name || `Track ${trackIndex + 1}`;
		const instrument = track.instrument?.name || (track.instrument?.percussion ? "Percussion" : "Unknown");

		track.notes.forEach((note, noteIndex) => {
			const mappedPieceId = mapMidiNoteToPiece(note.midi);
			const pieceId = mappedPieceId && kitPieceIds.has(mappedPieceId) ? mappedPieceId : null;
			const channel = Number.isFinite(track.channel) ? track.channel : 0;
			const timeMs = note.time * 1000;

			if (!pieceId) {
				const key = `${trackIndex}:${channel}:${note.midi}`;
				const existing = unmapped.get(key);
				if (existing) {
					existing.count += 1;
				} else {
					unmapped.set(key, {
						note: note.midi,
						noteName: note.name || noteNameFromMidi(note.midi),
						channel,
						trackName,
						count: 1,
						firstTimeMs: timeMs,
					});
				}
				return;
			}

			mappedCount += 1;
			hits.push({
				id: `${trackIndex}-${note.ticks}-${note.midi}-${noteIndex}`,
				tick: note.ticks,
				timeMs,
				durationMs: Math.max(20, note.duration * 1000),
				note: note.midi,
				noteName: note.name || noteNameFromMidi(note.midi),
				velocity: note.velocity,
				channel,
				pieceId,
				trackIndex,
				trackName,
			});
		});

		tracks.push({
			index: trackIndex,
			name: trackName,
			channel: Number.isFinite(track.channel) ? track.channel : 0,
			instrument,
			noteCount: track.notes.length,
			mappedCount,
		});
	});

	hits.sort((a, b) => a.timeMs - b.timeMs || a.note - b.note);
	const lastHitTime = hits.length > 0 ? hits[hits.length - 1].timeMs : 0;
	const beatTailMs = hits.length > 0 ? beatEndMsAfter(lastHitTime, midi.header.tempos[0]?.bpm ?? 120) : 0;
	const durationMs = Math.max(1000, midi.duration * 1000, beatTailMs);

	return {
		label,
		name: midi.name || midi.header.name || basename(label),
		durationMs,
		ppq: midi.header.ppq,
		bpm: midi.header.tempos[0]?.bpm ?? 120,
		hits,
		unmappedNotes: [...unmapped.values()].sort((a, b) => a.firstTimeMs - b.firstTimeMs),
		tracks,
	};
}
