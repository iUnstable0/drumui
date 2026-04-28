import * as Tone from "tone";
import type {DrumKit, KitPieceId, LaneStateMap, MidiHit, ParsedMidi, PlaybackControls} from "../types";
import type {HardwareTransport} from "../hardware/transport";
import {createLightEvent} from "../hardware/transport";
import {isLaneAudible} from "../kit/analog808";
import {getCanonicalSamplerNote, getChokeTargets, velocityToGain} from "./drumVoicing";
import {
	linearToDb,
	normalizeSpeed,
	originalMsToTransportSeconds,
	playbackPositionMsAtAudioTime,
	sanitizeLoopRange,
	shouldLoop,
} from "./playbackMath";
import {clamp} from "../utils/format";

interface DrumPlaybackCallbacks {
	onPosition: (positionMs: number) => void;
	onPlayingChange: (isPlaying: boolean) => void;
	onEnded: () => void;
	onError: (message: string) => void;
}

const DEFAULT_CONTROLS: PlaybackControls = {
	speed: 1,
	loopEnabled: false,
	loopStartMs: 0,
	loopEndMs: 4000,
	countInEnabled: false,
	metronomeEnabled: false,
	masterVolume: 0.85,
};

export class DrumPlaybackEngine {
	private masterVolume: Tone.Volume | null = null;
	private samplers = new Map<KitPieceId, Tone.Sampler>();
	private samplerNotes = new Map<KitPieceId, string>();
	private click: Tone.Synth | null = null;
	private session: ParsedMidi | null = null;
	private laneStates: LaneStateMap;
	private controls: PlaybackControls = DEFAULT_CONTROLS;
	private rafId: number | undefined;
	private active = false;

	constructor(
		private readonly kit: DrumKit,
		private readonly hardware: HardwareTransport,
		private readonly callbacks: DrumPlaybackCallbacks,
		laneStates: LaneStateMap,
	) {
		this.laneStates = laneStates;
	}

	setSession(session: ParsedMidi | null) {
		this.stop(false);
		this.session = session;
	}

	setLaneStates(laneStates: LaneStateMap) {
		this.laneStates = laneStates;
		this.applyLaneState();
	}

	setControls(controls: PlaybackControls) {
		const wasActive = this.active;
		const position = this.getPositionMs();
		this.controls = {...controls, speed: normalizeSpeed(controls.speed)};
		this.applyMasterVolume();

		if (wasActive && this.session) {
			void this.play(position, this.controls);
		}
	}

	async play(fromMs: number, controls = this.controls) {
		if (!this.session || this.session.hits.length === 0) return;

		this.controls = {...controls, speed: normalizeSpeed(controls.speed)};
		await this.ensureReady();
		this.stop(false);

		const session = this.session;
		const speed = this.controls.speed;
		const loopActive = shouldLoop(this.controls, session.durationMs);
		const loop = sanitizeLoopRange(session.durationMs, this.controls.loopStartMs, this.controls.loopEndMs);
		const startMs = loopActive ? clamp(fromMs, loop.startMs, loop.endMs - 1) : clamp(fromMs, 0, session.durationMs);
		const transport = Tone.getTransport();

		transport.cancel(0);
		transport.loop = loopActive;
		if (loopActive) {
			transport.setLoopPoints(
				originalMsToTransportSeconds(loop.startMs, speed),
				originalMsToTransportSeconds(loop.endMs, speed),
			);
		}

		for (const hit of session.hits) {
			transport.schedule((time) => this.playHit(hit, time), originalMsToTransportSeconds(hit.timeMs, speed));
		}

		if (this.controls.metronomeEnabled) {
			const beatSeconds = this.beatSeconds();
			transport.scheduleRepeat((time) => this.click?.triggerAttackRelease("C6", 0.03, time, 0.26), beatSeconds, 0);
		}

		if (!loopActive) {
			transport.scheduleOnce((time) => {
				Tone.getDraw().schedule(() => {
					this.stop(false);
					this.callbacks.onPosition(session.durationMs);
					this.callbacks.onEnded();
				}, time);
			}, originalMsToTransportSeconds(session.durationMs, speed) + 0.05);
		}

		const delaySeconds = this.controls.countInEnabled && startMs < 30 ? this.scheduleCountIn() : 0;
		this.active = true;
		this.callbacks.onPlayingChange(true);
		this.startPositionLoop();
		transport.start(delaySeconds > 0 ? `+${delaySeconds}` : undefined, originalMsToTransportSeconds(startMs, speed));
		this.callbacks.onPosition(startMs);
	}

	pause(): number {
		const position = this.getPositionMs();
		this.stop(false);
		this.callbacks.onPosition(position);
		return position;
	}

	stop(resetPosition = true) {
		const transport = Tone.getTransport();
		transport.stop();
		transport.cancel(0);
		transport.loop = false;
		Tone.getDraw().cancel(0);
		for (const sampler of this.samplers.values()) sampler.releaseAll();
		this.active = false;
		this.stopPositionLoop();
		this.callbacks.onPlayingChange(false);

		if (resetPosition) {
			this.callbacks.onPosition(0);
		}
	}

	seek(positionMs: number, controls = this.controls) {
		if (this.active) {
			void this.play(positionMs, controls);
			return;
		}

		this.controls = {...controls, speed: normalizeSpeed(controls.speed)};
		this.callbacks.onPosition(clamp(positionMs, 0, this.session?.durationMs ?? 0));
	}

	audition(pieceId: KitPieceId) {
		void this.ensureReady()
			.then(() => {
				if (!this.isAudible(pieceId)) return;
				const sampler = this.samplers.get(pieceId);
				const note = this.samplerNotes.get(pieceId);
				if (!sampler || !note) return;
				sampler.triggerAttack(note, undefined, 1);
			})
			.catch((error: unknown) => this.callbacks.onError(error instanceof Error ? error.message : String(error)));
	}

	dispose() {
		this.stop(false);
		for (const sampler of this.samplers.values()) sampler.dispose();
		this.samplers.clear();
		this.samplerNotes.clear();
		this.masterVolume?.dispose();
		this.masterVolume = null;
		this.click?.dispose();
		this.click = null;
	}

	private async ensureReady() {
		await Tone.start();
		if (this.masterVolume && this.samplers.size === this.kit.pieces.length) return;

		const masterVolume = new Tone.Volume(linearToDb(this.controls.masterVolume)).toDestination();
		this.masterVolume = masterVolume;
		const loadPromises = this.kit.pieces.map((piece) => new Promise<void>((resolve, reject) => {
			const note = getCanonicalSamplerNote(piece);
			const sampler = new Tone.Sampler({
				urls: {[note]: piece.sampleUrl},
				release: 0.025,
				onload: resolve,
				onerror: reject,
			}).connect(masterVolume);
			this.samplers.set(piece.id, sampler);
			this.samplerNotes.set(piece.id, note);
		}));

		this.click = new Tone.Synth({
			oscillator: {type: "square"},
			envelope: {attack: 0.001, decay: 0.035, sustain: 0, release: 0.02},
		}).connect(masterVolume);
		this.click.volume.value = linearToDb(0.35);

		try {
			await Promise.all(loadPromises);
		} catch (error) {
			for (const sampler of this.samplers.values()) sampler.dispose();
			this.samplers.clear();
			this.samplerNotes.clear();
			this.masterVolume?.dispose();
			this.masterVolume = null;
			this.click?.dispose();
			this.click = null;
			throw error;
		}

		this.applyMasterVolume();
		this.applyLaneState();
		await Tone.loaded();
	}

	private playHit(hit: MidiHit, time: number) {
		if (!this.session) return;
		if (!hit || !this.isAudible(hit.pieceId)) return;

		const velocity = velocityToGain(hit.velocity);
		if (velocity <= 0) return;

		const sampler = this.samplers.get(hit.pieceId);
		const note = this.samplerNotes.get(hit.pieceId);
		if (!sampler || !note) return;

		for (const chokeTarget of getChokeTargets(hit.pieceId)) {
			this.samplers.get(chokeTarget)?.releaseAll(time);
		}
		sampler.triggerAttack(note, time, velocity);

		const lightEvent = createLightEvent(hit, this.kit);
		Tone.getDraw().schedule(() => {
			void this.hardware.send([lightEvent]);
		}, time);
	}

	private applyMasterVolume() {
		if (!this.masterVolume) return;
		this.masterVolume.volume.value = linearToDb(this.controls.masterVolume);
		if (this.click) this.click.volume.value = linearToDb(0.35);
	}

	private applyLaneState() {
		if (this.samplers.size === 0) return;
		for (const piece of this.kit.pieces) {
			const sampler = this.samplers.get(piece.id);
			if (!sampler) continue;
			const lane = this.laneStates[piece.id];
			sampler.volume.value = linearToDb(this.isAudible(piece.id) ? lane.volume : 0);
		}
	}

	private isAudible(pieceId: KitPieceId): boolean {
		return isLaneAudible(pieceId, this.laneStates, this.kit);
	}

	private scheduleCountIn(): number {
		const beatSeconds = this.beatSeconds();
		const now = Tone.now();
		for (let beat = 0; beat < 4; beat += 1) {
			this.click?.triggerAttackRelease(beat === 3 ? "C7" : "C6", 0.04, now + beat * beatSeconds, 0.34);
		}
		return beatSeconds * 4;
	}

	private beatSeconds(): number {
		const bpm = this.session?.bpm ?? 120;
		return 60 / Math.max(40, bpm) / this.controls.speed;
	}

	private getPositionMs(): number {
		if (!this.session) return 0;
		return playbackPositionMsAtAudioTime(Tone.getTransport(), Tone.immediate(), this.controls.speed, this.session.durationMs);
	}

	private startPositionLoop() {
		this.stopPositionLoop();
		const tick = () => {
			if (!this.active) return;
			this.callbacks.onPosition(this.getPositionMs());
			this.rafId = window.requestAnimationFrame(tick);
		};
		this.rafId = window.requestAnimationFrame(tick);
	}

	private stopPositionLoop() {
		if (this.rafId !== undefined) {
			window.cancelAnimationFrame(this.rafId);
			this.rafId = undefined;
		}
	}
}
