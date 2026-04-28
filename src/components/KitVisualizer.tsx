import {For} from "solid-js";
import {KEYBOARD_DRUM_TRIGGER_HINTS} from "../keyboardShortcuts";
import type {DrumKit, KitPieceId, LaneStatusMap} from "../types";
import {ShortcutKeycap} from "./ShortcutKeycap";

interface KitVisualizerProps {
	kit: DrumKit;
	activeLights: Record<KitPieceId, number>;
	laneStatuses: LaneStatusMap;
	activePieceId: KitPieceId;
	onAudition: (pieceId: KitPieceId) => void;
	onFocus: (pieceId: KitPieceId) => void;
	onPointerLane: (pieceId: KitPieceId) => void;
}

export function KitVisualizer(props: KitVisualizerProps) {
	return (
		<section class="kit-stage" aria-label="808 drum kit light preview">
			<div class="kit-map">
				<div class="kit-map__board">
					<For each={props.kit.pieces}>
						{(piece) => {
							const intensity = () => props.activeLights[piece.id] ?? 0;
							const status = () => props.laneStatuses[piece.id];
							const shortcut = KEYBOARD_DRUM_TRIGGER_HINTS[piece.id];
							return (
								<button
									class="kit-piece"
									classList={{
										"is-active": intensity() > 0,
										"is-active-lane": props.activePieceId === piece.id,
										"is-lane-inactive": !status().audible,
										"is-lane-muted": status().reason === "muted",
										"is-lane-silent": status().reason === "silent",
										"is-lane-solo-excluded": status().reason === "solo-excluded",
									}}
									style={{
										"--piece-color": piece.color,
										"--light": String(intensity()),
										"--piece-size": `${piece.size}px`,
										left: `${piece.x}%`,
										top: `${piece.y}%`,
									}}
									data-lane-status={status().reason}
									aria-keyshortcuts={shortcut.aria}
									aria-disabled={!status().audible}
									aria-label={`Audition ${piece.label} (${shortcut.label})`}
									title={`${piece.label} (${piece.midiNotes.join(", ")})`}
									onClick={() => props.onAudition(piece.id)}
									onFocus={() => props.onFocus(piece.id)}
									onPointerEnter={() => props.onPointerLane(piece.id)}
									onPointerMove={() => props.onPointerLane(piece.id)}
								>
									<ShortcutKeycap hint={shortcut} class="shortcut-keycap--kit-piece"/>
									<span>{piece.shortLabel}</span>
									<small>{piece.label}</small>
								</button>
							);
						}}
					</For>
				</div>
			</div>
		</section>
	);
}
