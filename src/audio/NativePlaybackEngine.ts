import {invoke} from "@tauri-apps/api/core";
import {listen} from "@tauri-apps/api/event";
import type {PlaybackEngine, PlaybackEngineCallbacks} from "./PlaybackEngine";
import type {KitPieceId, LaneStateMap, LightEvent, ParsedMidi, PlaybackControls} from "../types";

type Unlisten = () => void;

interface NativePlaybackStatus {
	isPlaying: boolean;
	mode: "stopped" | "playing" | "countIn";
	positionMs: number;
	durationMs: number;
	speed: number;
	loopStartMs: number;
	loopEndMs: number;
	generatedAtNs: number;
}

interface NativeLightPulse {
	pieceId: KitPieceId;
	note: number;
	velocity: number;
	intensity: number;
	color: string;
	durationMs: number;
	atPositionMs: number;
}

const DEFAULT_STATUS: NativePlaybackStatus = {
	isPlaying: false,
	mode: "stopped",
	positionMs: 0,
	durationMs: 0,
	speed: 1,
	loopStartMs: 0,
	loopEndMs: 0,
	generatedAtNs: 0,
};

export class NativePlaybackEngine implements PlaybackEngine {
	private session: ParsedMidi | null = null;
	private controls: PlaybackControls | null = null;
	private laneStates: LaneStateMap;
	private status = DEFAULT_STATUS;
	private statusReceivedAt = performance.now();
	private rafId: number | undefined;
	private unlisteners: Unlisten[] = [];

	constructor(
		private readonly callbacks: PlaybackEngineCallbacks,
		laneStates: LaneStateMap,
	) {
		this.laneStates = laneStates;
		void listen<NativePlaybackStatus>("audio:status", (event) => this.handleStatus(event.payload))
			.then((unlisten) => this.unlisteners.push(unlisten))
			.catch((error: unknown) => this.callbacks.onError(String(error)));
		void listen<NativeLightPulse[]>("audio:lights", (event) => this.handleLights(event.payload))
			.then((unlisten) => this.unlisteners.push(unlisten))
			.catch((error: unknown) => this.callbacks.onError(String(error)));
		void listen<string>("audio:error", (event) => this.callbacks.onError(event.payload))
			.then((unlisten) => this.unlisteners.push(unlisten))
			.catch((error: unknown) => this.callbacks.onError(String(error)));
	}

	async loadMidiFile(path: string): Promise<ParsedMidi> {
		const session = await invoke<ParsedMidi>("audio_load_midi_file", {path});
		this.session = session;
		this.status = {...DEFAULT_STATUS, durationMs: session.durationMs, loopEndMs: session.durationMs};
		this.callbacks.onPlayingChange(false);
		this.callbacks.onPosition(0);
		return session;
	}

	setSession(session: ParsedMidi | null) {
		const previousSessionId = this.session?.sessionId;
		this.session = session;
		if (!session && previousSessionId) {
			void invoke("audio_clear_session", {sessionId: previousSessionId}).catch((error: unknown) => this.callbacks.onError(String(error)));
			this.stopInterpolation();
		}
	}

	setLaneStates(laneStates: LaneStateMap) {
		this.laneStates = laneStates;
		void invoke<NativePlaybackStatus>("audio_set_lane_states", {laneStates})
			.then((status) => this.handleStatus(status))
			.catch((error: unknown) => this.callbacks.onError(String(error)));
	}

	setControls(controls: PlaybackControls) {
		this.controls = controls;
		void invoke<NativePlaybackStatus>("audio_set_controls", {patch: controls})
			.then((status) => this.handleStatus(status))
			.catch((error: unknown) => this.callbacks.onError(String(error)));
	}

	async play(fromMs: number, controls = this.controls ?? undefined) {
		const sessionId = this.session?.sessionId;
		if (!sessionId || !controls) return;
		this.controls = controls;
		const status = await invoke<NativePlaybackStatus>("audio_play", {
			sessionId,
			fromMs,
			controls,
			laneStates: this.laneStates,
		});
		this.handleStatus(status);
	}

	async pause(): Promise<number> {
		const status = await invoke<NativePlaybackStatus>("audio_pause");
		this.handleStatus(status);
		return status.positionMs;
	}

	async stop(resetPosition = true) {
		const status = await invoke<NativePlaybackStatus>("audio_stop", {resetPosition});
		this.handleStatus(status);
	}

	async seek(positionMs: number, controls = this.controls ?? undefined) {
		if (controls) this.controls = controls;
		const status = await invoke<NativePlaybackStatus>("audio_seek", {positionMs});
		this.handleStatus(status);
	}

	async audition(pieceId: KitPieceId) {
		await invoke("audio_audition", {pieceId, velocity: 1});
	}

	dispose() {
		void this.stop(false).catch(() => undefined);
		this.stopInterpolation();
		for (const unlisten of this.unlisteners.splice(0)) unlisten();
	}

	private handleStatus(status: NativePlaybackStatus) {
		const wasPlaying = this.status.isPlaying;
		this.status = status;
		this.statusReceivedAt = performance.now();
		this.callbacks.onPlayingChange(status.isPlaying);
		this.callbacks.onPosition(status.positionMs);

		if (status.isPlaying) this.startInterpolation();
		else this.stopInterpolation();
		if (wasPlaying && !status.isPlaying && status.durationMs > 0 && status.positionMs >= status.durationMs - 1) {
			this.callbacks.onEnded();
		}
	}

	private handleLights(pulses: NativeLightPulse[]) {
		const events: LightEvent[] = pulses.map((pulse) => ({
			atMs: pulse.atPositionMs,
			pieceId: pulse.pieceId,
			note: pulse.note,
			velocity: pulse.velocity,
			intensity: pulse.intensity,
			color: pulse.color,
			durationMs: pulse.durationMs,
		}));
		if (events.length > 0) this.callbacks.onLightEvents(events);
	}

	private startInterpolation() {
		if (this.rafId !== undefined) return;
		const tick = () => {
			if (!this.status.isPlaying) {
				this.stopInterpolation();
				return;
			}

			const elapsedMs = performance.now() - this.statusReceivedAt;
			const nextPosition = this.status.mode === "playing"
				? Math.min(this.status.durationMs, this.status.positionMs + elapsedMs * this.status.speed)
				: this.status.positionMs;
			this.callbacks.onPosition(nextPosition);
			this.rafId = window.requestAnimationFrame(tick);
		};
		this.rafId = window.requestAnimationFrame(tick);
	}

	private stopInterpolation() {
		if (this.rafId === undefined) return;
		window.cancelAnimationFrame(this.rafId);
		this.rafId = undefined;
	}
}
