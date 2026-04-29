import { Show } from "solid-js";
import { EmptyState } from "./components/EmptyState";
import { FileLibrary } from "./components/FileLibrary";
import { KitVisualizer } from "./components/KitVisualizer";
import { MixerPanel } from "./components/MixerPanel";
import { Timeline } from "./components/Timeline";
import { TransportBar } from "./components/TransportBar";
import { ANALOG_808_KIT } from "./kit/analog808";
import { useDrumTrainer } from "./useDrumTrainer";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts";
import { useLoopVisualTween } from "./useLoopVisualTween";
import { useResizableLayout } from "./useResizableLayout";
import "./styles/global.scss";
import "./styles/App.scss";

function App() {
	const trainer = useDrumTrainer();
	const layout = useResizableLayout();
	const loopVisualStyle = useLoopVisualTween(() => trainer.controls().loopEnabled);

	useKeyboardShortcuts({
		onAdjustActiveVolume: trainer.adjustActiveVolume,
		onFocusLane: trainer.focusAdjacentLane,
		onNudgePlayback: trainer.nudgePlayback,
		onPadPress: trainer.pressPad,
		onPadRelease: trainer.releasePad,
		onRestart: trainer.restart,
		onStop: trainer.stop,
		onToggleClick: trainer.toggleClick,
		onToggleCountIn: trainer.toggleCountIn,
		onToggleActiveMute: trainer.toggleActiveMute,
		onToggleActiveSolo: trainer.toggleActiveSolo,
		onToggleLoop: trainer.toggleLoop,
		onTogglePlayback: trainer.togglePlayback,
	});

	return (
		<main
			class="app-shell"
			classList={{
				"is-library-collapsed": layout.libraryCollapsed(),
				"is-inspector-collapsed": layout.inspectorCollapsed(),
			}}
			style={{
				"--library-width": `${layout.libraryCollapsed() ? 52 : layout.libraryWidth()}px`,
				"--inspector-width": `${layout.inspectorCollapsed() ? 52 : layout.inspectorWidth()}px`,
				"--library-splitter-width": `${layout.libraryCollapsed() ? 0 : 8}px`,
				"--inspector-splitter-width": `${layout.inspectorCollapsed() ? 0 : 8}px`,
				"--kit-pane-height": `${layout.kitHeight()}px`,
			}}
		>
			<FileLibrary
				session={trainer.session()}
				fileLabel={trainer.fileLabel()}
				error={trainer.loadError()}
				isLoading={trainer.isLoading()}
				collapsed={layout.libraryCollapsed()}
				onToggleCollapse={layout.toggleLibraryCollapsed}
				onPick={trainer.pickFile}
				onClear={trainer.clearSession}
			/>
			<div
				class="resize-handle resize-handle--vertical"
				classList={{ "is-hidden": layout.libraryCollapsed() }}
				role="separator"
				aria-orientation="vertical"
				aria-label="Resize library"
				aria-hidden={layout.libraryCollapsed()}
				onDblClick={layout.reset}
				onPointerDown={(event) => {
					if (!layout.libraryCollapsed()) layout.beginResize("library", event);
				}}
			/>
			<section
				class="practice-shell"
				classList={{ "has-session": Boolean(trainer.session()) }}
				style={loopVisualStyle()}
				aria-label="808 light trainer practice area"
			>
				<Show
					when={trainer.session()}
					fallback={
						<EmptyState dragOver={trainer.dragOver()} isLoading={trainer.isLoading()} onPick={trainer.pickFile} />
					}
				>
					{(current) => (
						<>
							<KitVisualizer
								kit={ANALOG_808_KIT}
								activeLights={trainer.activeLights()}
								laneStatuses={trainer.laneStatuses()}
								activePieceId={trainer.activePieceId()}
								onAudition={trainer.audition}
								onFocus={trainer.focusLane}
								onPointerLane={trainer.pointAtLane}
							/>
							<div
								class="resize-handle resize-handle--horizontal"
								role="separator"
								aria-orientation="horizontal"
								aria-label="Resize kit and timeline"
								onDblClick={layout.reset}
								onPointerDown={(event) => layout.beginResize("kit", event)}
							/>
							<Timeline
								session={current()}
								kit={ANALOG_808_KIT}
								positionMs={trainer.playback().positionMs}
								laneStatuses={trainer.laneStatuses()}
								activePieceId={trainer.activePieceId()}
								controls={trainer.controls()}
								onSeek={trainer.seek}
								onLoopChange={(loopStartMs, loopEndMs) => trainer.updateControls({ loopStartMs, loopEndMs })}
								onLoopEnabledChange={(loopEnabled) => trainer.updateControls({ loopEnabled })}
								onFocusLane={trainer.focusLane}
								onPointerLane={trainer.pointAtLane}
								onPreviewHits={trainer.previewTimelineHits}
								onClearPreview={trainer.clearTimelinePreview}
								onAuditionLane={trainer.auditionLane}
							/>
						</>
					)}
				</Show>
					<TransportBar
						playback={trainer.playback()}
						controls={trainer.controls()}
						metronomeTick={trainer.metronomeTick()}
						canPlay={trainer.canPlay()}
					onToggle={trainer.togglePlayback}
					onRestart={trainer.restart}
					onStop={trainer.stop}
					onControlsChange={trainer.updateControls}
				/>
			</section>
			<div
				class="resize-handle resize-handle--vertical"
				classList={{ "is-hidden": layout.inspectorCollapsed() }}
				role="separator"
				aria-orientation="vertical"
				aria-label="Resize inspector"
				aria-hidden={layout.inspectorCollapsed()}
				onDblClick={layout.reset}
				onPointerDown={(event) => {
					if (!layout.inspectorCollapsed()) layout.beginResize("inspector", event);
				}}
			/>
			<MixerPanel
				kit={ANALOG_808_KIT}
				session={trainer.session()}
				activePieceId={trainer.activePieceId()}
				activeInputSource={trainer.activeInputSource()}
				laneStatuses={trainer.laneStatuses()}
				laneStates={trainer.laneStates}
				recentEvents={trainer.recentEvents()}
				collapsed={layout.inspectorCollapsed()}
				onToggleCollapse={layout.toggleInspectorCollapsed}
				onFocusLane={trainer.focusLane}
				onPointerLane={trainer.pointAtLane}
				onLaneChange={trainer.updateLane}
			/>
		</main>
	);
}

export default App;
