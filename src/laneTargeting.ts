import type { ActiveInputSource, ActiveLaneState, KitPieceId } from "./types";
import { KIT_PIECE_IDS } from "./types";
import { clamp } from "./utils/format";

export function createActiveLane(pieceId: KitPieceId, inputSource: ActiveInputSource): ActiveLaneState {
	return { pieceId, inputSource };
}

export function moveActiveLane(
	activeLane: ActiveLaneState,
	direction: -1 | 1,
	laneOrder: readonly KitPieceId[] = KIT_PIECE_IDS,
): ActiveLaneState {
	const fallbackIndex = Math.max(0, laneOrder.indexOf("kick"));
	const currentIndex = laneOrder.indexOf(activeLane.pieceId);
	const nextIndex = clamp((currentIndex >= 0 ? currentIndex : fallbackIndex) + direction, 0, laneOrder.length - 1);
	return createActiveLane(laneOrder[nextIndex] ?? activeLane.pieceId, "keyboard");
}
