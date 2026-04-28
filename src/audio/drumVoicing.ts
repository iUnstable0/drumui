import type {KitPiece, KitPieceId} from "../types";
import {clamp, noteNameFromMidi} from "../utils/format";

export const DEFAULT_SAMPLER_MIDI_NOTE = 60;

const CHOKE_TARGETS: Partial<Record<KitPieceId, KitPieceId[]>> = {
	closedHat: ["openHat"],
};

export function normalizeHitVelocity(velocity: number): number {
	if (!Number.isFinite(velocity)) return 0;
	return clamp(velocity, 0, 1);
}

export function velocityToGain(velocity: number): number {
	return normalizeHitVelocity(velocity);
}

export function getCanonicalSamplerNote(piece: KitPiece): string {
	return noteNameFromMidi(piece.midiNotes[0] ?? DEFAULT_SAMPLER_MIDI_NOTE);
}

export function getChokeTargets(pieceId: KitPieceId): KitPieceId[] {
	return CHOKE_TARGETS[pieceId] ?? [];
}
