import {IterationCw, Metronome, Pause, Play, RotateCcw, Square, Timer, TimerReset} from "lucide-solid";
import {KEYBOARD_SHORTCUT_HINTS} from "../keyboardShortcuts";
import type {PlaybackControls, PlaybackViewState} from "../types";
import {formatPercent, formatTime} from "../utils/format";
import {IconButton} from "./IconButton";
import {RangeControl} from "./RangeControl";
import {ShortcutKeycap} from "./ShortcutKeycap";

interface TransportBarProps {
	playback: PlaybackViewState;
	controls: PlaybackControls;
	canPlay: boolean;
	onToggle: () => void;
	onRestart: () => void;
	onStop: () => void;
	onControlsChange: (controls: Partial<PlaybackControls>) => void;
}

export function TransportBar(props: TransportBarProps) {
	return (
		<footer class="transport-bar">
			<div class="transport-control-cluster">
				<div class="transport-buttons">
					<IconButton label="Restart" shortcut={KEYBOARD_SHORTCUT_HINTS.restart} disabled={!props.canPlay} onClick={props.onRestart}>
						<RotateCcw/>
					</IconButton>
					<IconButton
						label={props.playback.isPlaying ? "Pause" : "Play"}
						shortcut={KEYBOARD_SHORTCUT_HINTS.togglePlayback}
						disabled={!props.canPlay}
						tone="primary"
						onClick={props.onToggle}
					>
						{props.playback.isPlaying ? <Pause fill="currentColor" strokeWidth={0}/> : <Play fill="currentColor" strokeWidth={0}/>}
					</IconButton>
					<IconButton label="Stop" shortcut={KEYBOARD_SHORTCUT_HINTS.stop} disabled={!props.canPlay} onClick={props.onStop}>
						<Square fill="currentColor" strokeWidth={0}/>
					</IconButton>
				</div>
			</div>

			<div class="transport-time">
				<Timer/>
				<span>{formatTime(props.playback.positionMs)} / {formatTime(props.playback.durationMs)}</span>
				<div class="transport-time__shortcuts" aria-hidden="true">
					<span><ShortcutKeycap hint={KEYBOARD_SHORTCUT_HINTS.nudgePlayback}/> Nudge</span>
					<span><ShortcutKeycap hint={KEYBOARD_SHORTCUT_HINTS.focusLane}/> Lane</span>
				</div>
			</div>

			<div class="transport-sliders">
				<RangeControl
					label="Speed"
					value={props.controls.speed}
					min={0.25}
					max={2}
					step={0.05}
					disabled={!props.canPlay}
					valueText={formatPercent(props.controls.speed)}
					onChange={(speed) => props.onControlsChange({speed})}
				/>
				<RangeControl
					label="Master"
					value={props.controls.masterVolume}
					min={0}
					max={1}
					step={0.01}
					valueText={formatPercent(props.controls.masterVolume)}
					onChange={(masterVolume) => props.onControlsChange({masterVolume})}
				/>
			</div>

			<div class="mode-toggles" aria-label="Playback modes">
				<button
					classList={{"is-active": props.controls.loopEnabled}}
					aria-keyshortcuts={KEYBOARD_SHORTCUT_HINTS.toggleLoop.aria}
					aria-label={`Loop (${KEYBOARD_SHORTCUT_HINTS.toggleLoop.label})`}
					aria-pressed={props.controls.loopEnabled}
					onClick={() => props.onControlsChange({loopEnabled: !props.controls.loopEnabled})}
				>
					<IterationCw/>
					<span>Loop</span>
					<ShortcutKeycap hint={KEYBOARD_SHORTCUT_HINTS.toggleLoop} class="shortcut-keycap--mode-hover"/>
				</button>
				<button
					classList={{"is-active": props.controls.countInEnabled}}
					aria-keyshortcuts={KEYBOARD_SHORTCUT_HINTS.toggleCountIn.aria}
					aria-label={`Count-in (${KEYBOARD_SHORTCUT_HINTS.toggleCountIn.label})`}
					aria-pressed={props.controls.countInEnabled}
					onClick={() => props.onControlsChange({countInEnabled: !props.controls.countInEnabled})}
				>
					<TimerReset/>
					<span>Count-in</span>
					<ShortcutKeycap hint={KEYBOARD_SHORTCUT_HINTS.toggleCountIn} class="shortcut-keycap--mode-hover"/>
				</button>
				<button
					classList={{"is-active": props.controls.metronomeEnabled}}
					aria-keyshortcuts={KEYBOARD_SHORTCUT_HINTS.toggleClick.aria}
					aria-label={`Metronome (${KEYBOARD_SHORTCUT_HINTS.toggleClick.label})`}
					aria-pressed={props.controls.metronomeEnabled}
					onClick={() => props.onControlsChange({metronomeEnabled: !props.controls.metronomeEnabled})}
				>
					<Metronome/>
					<span>Metronome</span>
					<ShortcutKeycap hint={KEYBOARD_SHORTCUT_HINTS.toggleClick} class="shortcut-keycap--mode-hover"/>
				</button>
			</div>
		</footer>
	);
}
