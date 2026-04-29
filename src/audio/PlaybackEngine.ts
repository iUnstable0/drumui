import type { KitPieceId, LaneStateMap, LightEvent, ParsedMidi, PlaybackControls } from "../types";
import { NativePlaybackEngine } from "./NativePlaybackEngine";

export interface PlaybackEngineCallbacks {
	onPosition: (positionMs: number) => void;
	onPlayingChange: (isPlaying: boolean) => void;
	onEnded: () => void;
	onError: (message: string) => void;
	onLightEvents: (events: LightEvent[]) => void;
	onMetronomeTick: () => void;
}

export interface PlaybackEngine {
	loadMidiFile?: (path: string) => Promise<ParsedMidi>;
	setSession: (session: ParsedMidi | null) => void;
	setLaneStates: (laneStates: LaneStateMap) => void;
	setControls: (controls: PlaybackControls) => void;
	play: (fromMs: number, controls?: PlaybackControls) => Promise<void> | void;
	pause: () => Promise<number | undefined> | number | undefined;
	stop: (resetPosition?: boolean) => Promise<void> | void;
	seek: (positionMs: number, controls?: PlaybackControls) => Promise<void> | void;
	audition: (pieceId: KitPieceId) => Promise<void> | void;
	dispose: () => void;
}

export function createPlaybackEngine(callbacks: PlaybackEngineCallbacks, laneStates: LaneStateMap): PlaybackEngine {
	return new NativePlaybackEngine(callbacks, laneStates);
}
