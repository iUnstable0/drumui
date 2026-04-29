import { createMemo, createSignal, onCleanup } from "solid-js";
import { createStore } from "solid-js/store";
import { createPlaybackEngine } from "./audio/PlaybackEngine";
import { createDefaultLoopRange, halfBeatMsFromBpm, snapLoopRangeToBeatGrid } from "./audio/playbackMath";
import {
	ANALOG_808_KIT,
	cloneLaneStateMap,
	createDefaultLaneState,
	createLaneStatusMap,
	getKitPiece,
} from "./kit/analog808";
import { createActiveLane, moveActiveLane } from "./laneTargeting";
import { pickMidiPath } from "./midi/fileAccess";
import { useTauriMidiDrop } from "./midi/useTauriMidiDrop";
import type {
	ActiveInputSource,
	KitPieceId,
	LaneState,
	LightEvent,
	MidiHit,
	ParsedMidi,
	PlaybackControls,
	PlaybackViewState,
} from "./types";
import { KIT_PIECE_IDS } from "./types";
import { clamp, getErrorMessage } from "./utils/format";

const defaultLights = () => Object.fromEntries(KIT_PIECE_IDS.map((id) => [id, 0])) as Record<KitPieceId, number>;
const kitPieceIds = ANALOG_808_KIT.pieces.map((piece) => piece.id);

function combineLights(...lightMaps: Array<Record<KitPieceId, number>>) {
	return Object.fromEntries(
		KIT_PIECE_IDS.map((id) => [id, Math.max(...lightMaps.map((lights) => lights[id] ?? 0))]),
	) as Record<KitPieceId, number>;
}

export function useDrumTrainer() {
	const [session, setSession] = createSignal<ParsedMidi | null>(null);
	const [fileLabel, setFileLabel] = createSignal<string | null>(null);
	const [isLoading, setIsLoading] = createSignal(false);
	const [dragOver, setDragOver] = createSignal(false);
	const [loadError, setLoadError] = createSignal<string | null>(null);
	const [playbackLights, setPlaybackLights] = createSignal(defaultLights());
	const [manualPadLights, setManualPadLights] = createSignal(defaultLights());
	const [timelinePreviewLights, setTimelinePreviewLights] = createSignal(defaultLights());
	const [recentEvents, setRecentEvents] = createSignal<LightEvent[]>([]);
	const [metronomeTick, setMetronomeTick] = createSignal(0);
	const [playback, setPlayback] = createSignal<PlaybackViewState>({ isPlaying: false, positionMs: 0, durationMs: 0 });
	const [activeLane, setActiveLaneState] = createSignal(createActiveLane("kick", "focus"));
	const [controls, setControls] = createStore<PlaybackControls>({
		speed: 1,
		loopEnabled: false,
		loopStartMs: 0,
		loopEndMs: 4000,
		countInEnabled: false,
		metronomeEnabled: false,
		masterVolume: 0.6,
	});
	const [laneStates, setLaneStates] = createStore(createDefaultLaneState());

	const lightTimers: Partial<Record<KitPieceId, number>> = {};
	const manualPadTimers: Partial<Record<KitPieceId, number>> = {};
	const engine = createPlaybackEngine(
		{
			onPosition: (positionMs) => setPlayback((state) => ({ ...state, positionMs })),
			onPlayingChange: (isPlaying) => setPlayback((state) => ({ ...state, isPlaying })),
			onEnded: () => setPlayback((state) => ({ ...state, isPlaying: false })),
			onError: setLoadError,
			onLightEvents: handleLightEvents,
			onMetronomeTick: () => setMetronomeTick((tick) => tick + 1),
		},
		cloneLaneStateMap(laneStates),
	);

	const canPlay = () => Boolean(session()?.hits.length) && !isLoading();
	const activeLights = createMemo(() => combineLights(playbackLights(), manualPadLights(), timelinePreviewLights()));
	const laneStatuses = createMemo(() => createLaneStatusMap(laneStates, ANALOG_808_KIT));
	const activePieceId = createMemo(() => activeLane().pieceId);
	const activeInputSource = createMemo(() => activeLane().inputSource);
	const controlsSnapshot = (patch: Partial<PlaybackControls> = {}): PlaybackControls => ({ ...controls, ...patch });

	useTauriMidiDrop(loadFile, setDragOver);
	onCleanup(() => {
		engine.dispose();
		for (const timer of Object.values(lightTimers)) {
			if (timer) window.clearTimeout(timer);
		}
		for (const timer of Object.values(manualPadTimers)) {
			if (timer) window.clearTimeout(timer);
		}
	});

	function reportEngineError(error: unknown) {
		setLoadError(getErrorMessage(error));
	}

	function runEngineTask(task: Promise<unknown> | unknown) {
		void Promise.resolve(task).catch(reportEngineError);
	}

	async function applySession(label: string, parsed: ParsedMidi) {
		const lastHit = parsed.hits[parsed.hits.length - 1];
		const defaultLoop = createDefaultLoopRange(parsed.durationMs, parsed.bpm, lastHit?.timeMs);
		setSession(parsed);
		engine.setSession(parsed);
		setPlayback({ isPlaying: false, positionMs: 0, durationMs: parsed.durationMs });
		updateControls({ loopStartMs: defaultLoop.startMs, loopEndMs: defaultLoop.endMs });
		if (parsed.hits.length === 0) setLoadError("No mapped drum notes were found in this MIDI file.");
		setFileLabel(label);
	}

	async function loadMidiFile(path: string) {
		setIsLoading(true);
		setLoadError(null);
		setFileLabel(path);
		setRecentEvents([]);
		setPlaybackLights(defaultLights());
		setManualPadLights(defaultLights());
		setTimelinePreviewLights(defaultLights());
		setMetronomeTick(0);
		try {
			await Promise.resolve(engine.stop());
			if (!engine.loadMidiFile) throw new Error("Native audio engine is unavailable.");
			await applySession(path, await engine.loadMidiFile(path));
		} catch (error) {
			setSession(null);
			setPlayback({ isPlaying: false, positionMs: 0, durationMs: 0 });
			setLoadError(getErrorMessage(error));
		} finally {
			setIsLoading(false);
		}
	}

	function loadFile(path: string) {
		void loadMidiFile(path);
	}

	async function pickFile() {
		if (isLoading()) return;
		const path = await pickMidiPath();
		if (path) loadFile(path);
	}

	function clearSession() {
		runEngineTask(engine.stop());
		engine.setSession(null);
		setSession(null);
		setFileLabel(null);
		setLoadError(null);
		setRecentEvents([]);
		setPlaybackLights(defaultLights());
		setManualPadLights(defaultLights());
		setTimelinePreviewLights(defaultLights());
		setMetronomeTick(0);
		setPlayback({ isPlaying: false, positionMs: 0, durationMs: 0 });
	}

	async function togglePlayback() {
		if (!canPlay()) return;
		if (playback().isPlaying) {
			runEngineTask(engine.pause());
			return;
		}
		try {
			await engine.play(playback().positionMs, controlsSnapshot());
		} catch (error) {
			setLoadError(getErrorMessage(error));
		}
	}

	function updateControls(patch: Partial<PlaybackControls>) {
		const currentSession = session();
		let normalizedPatch = patch;
		if (currentSession && ("loopStartMs" in patch || "loopEndMs" in patch)) {
			const loop = snapLoopRangeToBeatGrid(
				currentSession.durationMs,
				patch.loopStartMs ?? controls.loopStartMs,
				patch.loopEndMs ?? controls.loopEndMs,
				currentSession.bpm,
			);
			normalizedPatch = {
				...patch,
				loopStartMs: loop.startMs,
				loopEndMs: loop.endMs,
			};
		}
		const next = controlsSnapshot(normalizedPatch);
		setControls(normalizedPatch);
		engine.setControls(next);
	}

	function updateLane(pieceId: KitPieceId, patch: Partial<LaneState>) {
		const next = cloneLaneStateMap(laneStates);
		next[pieceId] = { ...next[pieceId], ...patch };
		setLaneStates(pieceId, patch);
		setTimelinePreviewLights(defaultLights());
		engine.setLaneStates(next);
	}

	function setActiveLane(pieceId: KitPieceId, inputSource: ActiveInputSource) {
		setActiveLaneState(createActiveLane(pieceId, inputSource));
	}

	function focusLane(pieceId: KitPieceId) {
		setActiveLane(pieceId, "focus");
	}

	function pointAtLane(pieceId: KitPieceId) {
		setActiveLane(pieceId, "pointer");
	}

	function focusAdjacentLane(direction: -1 | 1) {
		setActiveLaneState((current) => moveActiveLane(current, direction, kitPieceIds));
	}

	function nudgePlayback(direction: -1 | 1) {
		const currentSession = session();
		if (!currentSession) return;

		const stepMs = halfBeatMsFromBpm(currentSession.bpm);
		const nextPositionMs = clamp(playback().positionMs + direction * stepMs, 0, currentSession.durationMs);
		runEngineTask(engine.seek(nextPositionMs, controlsSnapshot()));
	}

	function toggleActiveMute() {
		const pieceId = activePieceId();
		updateLane(pieceId, { muted: !laneStates[pieceId].muted });
	}

	function toggleActiveSolo() {
		const pieceId = activePieceId();
		updateLane(pieceId, { soloed: !laneStates[pieceId].soloed });
	}

	function adjustActiveVolume(delta: number) {
		const pieceId = activePieceId();
		updateLane(pieceId, { volume: clamp(laneStates[pieceId].volume + delta, 0, 1) });
	}

	function pressPad(pieceId: KitPieceId) {
		setActiveLane(pieceId, "pad");
		window.clearTimeout(manualPadTimers[pieceId]);
		manualPadTimers[pieceId] = undefined;
		if (!laneStatuses()[pieceId].audible) {
			setManualPadLights((previous) => ({ ...previous, [pieceId]: 0 }));
			return;
		}
		setManualPadLights((previous) => ({ ...previous, [pieceId]: 1 }));
		runEngineTask(engine.audition(pieceId));
	}

	function releasePad(pieceId: KitPieceId) {
		window.clearTimeout(manualPadTimers[pieceId]);
		manualPadTimers[pieceId] = undefined;
		setManualPadLights((previous) => ({ ...previous, [pieceId]: 0 }));
	}

	function triggerPad(pieceId: KitPieceId) {
		pressPad(pieceId);
		manualPadTimers[pieceId] = window.setTimeout(() => releasePad(pieceId), getKitPiece(pieceId).lightDurationMs);
	}

	function auditionLane(pieceId: KitPieceId) {
		setActiveLane(pieceId, "focus");
		window.clearTimeout(manualPadTimers[pieceId]);
		manualPadTimers[pieceId] = undefined;
		if (!laneStatuses()[pieceId].audible) {
			setManualPadLights((previous) => ({ ...previous, [pieceId]: 0 }));
			return;
		}
		setManualPadLights((previous) => ({ ...previous, [pieceId]: 1 }));
		runEngineTask(engine.audition(pieceId));
		manualPadTimers[pieceId] = window.setTimeout(() => releasePad(pieceId), getKitPiece(pieceId).lightDurationMs);
	}

	function previewTimelineHits(hits: MidiHit[]) {
		const nextLights = defaultLights();
		for (const hit of hits) {
			if (!laneStatuses()[hit.pieceId].audible) continue;
			nextLights[hit.pieceId] = Math.max(nextLights[hit.pieceId], clamp(hit.velocity, 0, 1));
		}
		setTimelinePreviewLights(nextLights);
	}

	function clearTimelinePreview() {
		setTimelinePreviewLights(defaultLights());
	}

	function handleLightEvents(events: LightEvent[]) {
		setRecentEvents((previous) => [...events, ...previous].slice(0, 12));
		for (const event of events) {
			window.clearTimeout(lightTimers[event.pieceId]);
			setPlaybackLights((previous) => ({ ...previous, [event.pieceId]: event.intensity }));
			lightTimers[event.pieceId] = window.setTimeout(() => {
				setPlaybackLights((previous) => ({ ...previous, [event.pieceId]: 0 }));
			}, event.durationMs);
		}
	}

	return {
		session,
		fileLabel,
		isLoading,
		dragOver,
		loadError,
		activeLights,
		laneStatuses,
		recentEvents,
		metronomeTick,
		playback,
		activeInputSource,
		activePieceId,
		laneStates,
		canPlay,
		controls: controlsSnapshot,
		pickFile,
		clearSession,
		togglePlayback,
		updateControls,
		updateLane,
		focusLane,
		pointAtLane,
		previewTimelineHits,
		clearTimelinePreview,
		focusAdjacentLane,
		nudgePlayback,
		toggleLoop: () => updateControls({ loopEnabled: !controls.loopEnabled }),
		toggleClick: () => updateControls({ metronomeEnabled: !controls.metronomeEnabled }),
		toggleCountIn: () => updateControls({ countInEnabled: !controls.countInEnabled }),
		toggleActiveMute,
		toggleActiveSolo,
		adjustActiveVolume,
		pressPad,
		releasePad,
		seek: (positionMs: number) => runEngineTask(engine.seek(positionMs, controlsSnapshot())),
		restart: () => runEngineTask(engine.seek(0, controlsSnapshot())),
		stop: () => runEngineTask(engine.stop()),
		audition: triggerPad,
		auditionLane,
	};
}
