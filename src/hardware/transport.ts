import type {DrumKit, LightEvent, MidiHit} from "../types";
import {getKitPiece} from "../kit/analog808";
import {clamp} from "../utils/format";

export interface HardwareTransport {
	connect(): Promise<void>;
	disconnect(): Promise<void>;
	send(events: LightEvent[]): Promise<void>;
	readonly connected: boolean;
}

export class PreviewTransport implements HardwareTransport {
	#connected = false;

	constructor(private readonly onEvents: (events: LightEvent[]) => void) {}

	get connected() {
		return this.#connected;
	}

	async connect() {
		this.#connected = true;
	}

	async disconnect() {
		this.#connected = false;
	}

	async send(events: LightEvent[]) {
		if (!this.#connected) {
			await this.connect();
		}

		this.onEvents(events);
	}
}

export function createLightEvent(hit: MidiHit, kit: DrumKit): LightEvent {
	const piece = getKitPiece(hit.pieceId, kit);
	return {
		atMs: hit.timeMs,
		pieceId: hit.pieceId,
		note: hit.note,
		velocity: hit.velocity,
		intensity: clamp(hit.velocity, 0, 1),
		color: piece.color,
		durationMs: piece.lightDurationMs,
	};
}
