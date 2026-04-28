export const KIT_PIECE_IDS = [
	"kick",
	"snare",
	"clap",
	"closedHat",
	"openHat",
	"lowTom",
	"midTom",
	"crash",
	"ride",
] as const;

export type KitPieceId = (typeof KIT_PIECE_IDS)[number];

export interface KitPiece {
	id: KitPieceId;
	label: string;
	shortLabel: string;
	midiNotes: number[];
	sampleUrl: string;
	color: string;
	lightDurationMs: number;
	x: number;
	y: number;
	size: number;
}

export interface DrumKit {
	id: string;
	name: string;
	source: string;
	license: string;
	pieces: KitPiece[];
}

export interface MidiHit {
	id: string;
	tick: number;
	timeMs: number;
	durationMs: number;
	note: number;
	noteName: string;
	velocity: number;
	channel: number;
	pieceId: KitPieceId;
	trackIndex: number;
	trackName: string;
}

export interface UnmappedMidiNote {
	note: number;
	noteName: string;
	channel: number;
	trackName: string;
	count: number;
	firstTimeMs: number;
}

export interface MidiTrackSummary {
	index: number;
	name: string;
	channel: number;
	instrument: string;
	noteCount: number;
	mappedCount: number;
}

export interface ParsedMidi {
	label: string;
	name: string;
	durationMs: number;
	ppq: number;
	bpm: number;
	hits: MidiHit[];
	unmappedNotes: UnmappedMidiNote[];
	tracks: MidiTrackSummary[];
}

export interface LaneState {
	volume: number;
	muted: boolean;
	soloed: boolean;
}

export type LaneStateMap = Record<KitPieceId, LaneState>;

export type LaneStatusReason = "audible" | "muted" | "solo-excluded" | "silent";

export interface LaneStatus {
	audible: boolean;
	reason: LaneStatusReason;
}

export type LaneStatusMap = Record<KitPieceId, LaneStatus>;

export type ActiveInputSource = "pointer" | "keyboard" | "focus" | "pad";

export interface ActiveLaneState {
	pieceId: KitPieceId;
	inputSource: ActiveInputSource;
}

export interface PlaybackControls {
	speed: number;
	loopEnabled: boolean;
	loopStartMs: number;
	loopEndMs: number;
	countInEnabled: boolean;
	metronomeEnabled: boolean;
	masterVolume: number;
}

export interface PlaybackViewState {
	isPlaying: boolean;
	positionMs: number;
	durationMs: number;
}

export interface LightEvent {
	atMs: number;
	pieceId: KitPieceId;
	note: number;
	velocity: number;
	intensity: number;
	color: string;
	durationMs: number;
}
