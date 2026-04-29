import type { DrumKit, KitPiece, KitPieceId, LaneStateMap, LaneStatus, LaneStatusMap } from "../types";
import { KIT_PIECE_IDS } from "../types";
import analog808 from "./analog808.json";

export const ANALOG_808_KIT: DrumKit = analog808 as DrumKit;

const noteToPiece = new Map<number, KitPieceId>(
	ANALOG_808_KIT.pieces.flatMap((piece) => piece.midiNotes.map((note) => [note, piece.id] as const)),
);

export function mapMidiNoteToPiece(note: number): KitPieceId | null {
	return noteToPiece.get(note) ?? null;
}

export function getKitPiece(pieceId: KitPieceId, kit = ANALOG_808_KIT): KitPiece {
	const piece = kit.pieces.find((candidate) => candidate.id === pieceId);
	if (!piece) {
		throw new Error(`Unknown kit piece: ${pieceId}`);
	}

	return piece;
}

export function createDefaultLaneState(): LaneStateMap {
	return Object.fromEntries(
		KIT_PIECE_IDS.map((id) => [id, { volume: 0.9, muted: false, soloed: false }]),
	) as LaneStateMap;
}

export function cloneLaneStateMap(states: LaneStateMap): LaneStateMap {
	return Object.fromEntries(KIT_PIECE_IDS.map((id) => [id, { ...states[id] }])) as LaneStateMap;
}

export function getLaneStatus(pieceId: KitPieceId, states: LaneStateMap, kit = ANALOG_808_KIT): LaneStatus {
	const soloActive = kit.pieces.some((piece) => states[piece.id].soloed);
	const lane = states[pieceId];
	if (lane.muted) return { audible: false, reason: "muted" };
	if (lane.volume <= 0.001) return { audible: false, reason: "silent" };
	if (soloActive && !lane.soloed) return { audible: false, reason: "solo-excluded" };
	return { audible: true, reason: "audible" };
}

export function isLaneAudible(pieceId: KitPieceId, states: LaneStateMap, kit = ANALOG_808_KIT): boolean {
	return getLaneStatus(pieceId, states, kit).audible;
}

export function createLaneStatusMap(states: LaneStateMap, kit = ANALOG_808_KIT): LaneStatusMap {
	return Object.fromEntries(
		kit.pieces.map((piece) => [piece.id, getLaneStatus(piece.id, states, kit)]),
	) as LaneStatusMap;
}
