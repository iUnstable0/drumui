import * as Tabs from "@kobalte/core/tabs";
import {BellRing, ListMusic, PanelRightClose, PanelRightOpen, SlidersHorizontal} from "lucide-solid";
import {For, Show} from "solid-js";
import {KEYBOARD_SHORTCUT_HINTS} from "../keyboardShortcuts";
import type {ActiveInputSource, DrumKit, KitPieceId, LaneState, LaneStateMap, LaneStatusMap, LightEvent, ParsedMidi} from "../types";
import {formatPercent, formatTime} from "../utils/format";
import {RangeControl} from "./RangeControl";
import {ShortcutKeycap} from "./ShortcutKeycap";

interface MixerPanelProps {
	kit: DrumKit;
	session: ParsedMidi | null;
	activePieceId: KitPieceId;
	activeInputSource: ActiveInputSource;
	laneStatuses: LaneStatusMap;
	laneStates: LaneStateMap;
	recentEvents: LightEvent[];
	collapsed: boolean;
	onToggleCollapse: () => void;
	onFocusLane: (pieceId: KitPieceId) => void;
	onPointerLane: (pieceId: KitPieceId) => void;
	onLaneChange: (pieceId: KitPieceId, patch: Partial<LaneState>) => void;
}

export function MixerPanel(props: MixerPanelProps) {
	const activePiece = () => props.kit.pieces.find((piece) => piece.id === props.activePieceId) ?? props.kit.pieces[0];

	return (
		<Show
			when={props.collapsed}
			fallback={
				<aside class="inspector-panel">
					<div class="inspector-heading">
						<h2>Inspector</h2>
						<button class="panel-icon-button" aria-label="Collapse inspector" onClick={props.onToggleCollapse}>
							<PanelRightClose/>
						</button>
					</div>
					<Tabs.Root defaultValue="mix" class="tabs">
						<Tabs.List class="tabs__list" aria-label="Inspector panels">
							<Tabs.Trigger value="mix"><SlidersHorizontal/> Mix</Tabs.Trigger>
							<Tabs.Trigger value="midi"><ListMusic/> MIDI</Tabs.Trigger>
							<Tabs.Trigger value="lights"><BellRing/> Lights</Tabs.Trigger>
						</Tabs.List>

						<Tabs.Content value="mix" class="tabs__content">
							<div class="shortcut-strip shortcut-strip--mixer" aria-hidden="true">
								<span class="shortcut-strip__target" style={{"--piece-color": activePiece()?.color ?? "var(--accent)"}}>
									<i/>
									{activePiece()?.label ?? "Kick"}
								</span>
								<span><ShortcutKeycap hint={KEYBOARD_SHORTCUT_HINTS.toggleMute}/> Mute</span>
								<span><ShortcutKeycap hint={KEYBOARD_SHORTCUT_HINTS.toggleSolo}/> Solo</span>
								<span><ShortcutKeycap hint={KEYBOARD_SHORTCUT_HINTS.adjustVolumeDown}/><ShortcutKeycap hint={KEYBOARD_SHORTCUT_HINTS.adjustVolumeUp}/> Level</span>
							</div>
							<div class="mixer-list">
								<For each={props.kit.pieces}>
									{(piece) => {
										const lane = () => props.laneStates[piece.id];
										const status = () => props.laneStatuses[piece.id];
										return (
											<div
												class="mixer-row"
												classList={{
													"is-active-lane": props.activePieceId === piece.id,
													"is-keyboard-target": props.activePieceId === piece.id && props.activeInputSource === "keyboard",
													"is-lane-inactive": !status().audible,
													"is-lane-muted": status().reason === "muted",
													"is-lane-silent": status().reason === "silent",
													"is-lane-solo-excluded": status().reason === "solo-excluded",
												}}
												data-lane-status={status().reason}
												style={{"--piece-color": piece.color}}
												tabIndex={0}
												onClick={() => props.onFocusLane(piece.id)}
												onFocusIn={() => props.onFocusLane(piece.id)}
												onPointerEnter={() => props.onPointerLane(piece.id)}
												onPointerMove={() => props.onPointerLane(piece.id)}
											>
												<div class="mixer-row__top">
													<span>{piece.label}</span>
													<div>
														<button
															classList={{"is-active": lane().muted}}
															aria-keyshortcuts={KEYBOARD_SHORTCUT_HINTS.toggleMute.aria}
															aria-label={`Mute ${piece.label} (${KEYBOARD_SHORTCUT_HINTS.toggleMute.label})`}
															onClick={() => props.onLaneChange(piece.id, {muted: !lane().muted})}
														>
															M
														</button>
														<button
															classList={{"is-active": lane().soloed}}
															aria-keyshortcuts={KEYBOARD_SHORTCUT_HINTS.toggleSolo.aria}
															aria-label={`Solo ${piece.label} (${KEYBOARD_SHORTCUT_HINTS.toggleSolo.label})`}
															onClick={() => props.onLaneChange(piece.id, {soloed: !lane().soloed})}
														>
															S
														</button>
													</div>
												</div>
												<RangeControl
													label="Level"
													value={lane().volume}
													min={0}
													max={1}
													step={0.01}
													valueText={formatPercent(lane().volume)}
													onChange={(volume) => props.onLaneChange(piece.id, {volume})}
												/>
											</div>
										);
									}}
								</For>
							</div>
						</Tabs.Content>

						<Tabs.Content value="midi" class="tabs__content">
							<Show when={props.session} fallback={<p class="muted-copy">No file loaded.</p>}>
								{(session) => (
									<div class="midi-inspector">
										<div class="stat-grid">
											<div>
												<strong>{session().hits.length}</strong>
												<span>Hits</span>
											</div>
											<div>
												<strong>{session().unmappedNotes.length}</strong>
												<span>Unmapped</span>
											</div>
										</div>
										<For each={session().unmappedNotes.slice(0, 8)}>
											{(note) => (
												<div class="unmapped-row">
													<span>{note.noteName}</span>
													<small>ch {note.channel + 1} · {note.count}x</small>
												</div>
											)}
										</For>
									</div>
								)}
							</Show>
						</Tabs.Content>

						<Tabs.Content value="lights" class="tabs__content">
							<div class="light-feed">
								<Show when={props.recentEvents.length > 0} fallback={<p class="muted-copy">No hits yet.</p>}>
									<For each={props.recentEvents}>
										{(event) => {
											const piece = props.kit.pieces.find((candidate) => candidate.id === event.pieceId);
											return (
												<div class="light-feed__row" style={{"--piece-color": event.color}}>
													<span>{piece?.label ?? event.pieceId}</span>
													<small>{formatPercent(event.intensity)} · {formatTime(event.atMs)}</small>
												</div>
											);
										}}
									</For>
								</Show>
							</div>
						</Tabs.Content>
					</Tabs.Root>
				</aside>
			}
		>
			<aside class="inspector-panel panel-rail" aria-label="Inspector collapsed">
				<button class="panel-rail__button" aria-label="Expand inspector" onClick={props.onToggleCollapse}>
					<PanelRightOpen/>
				</button>
				<div class="panel-rail__active" style={{"--piece-color": activePiece()?.color ?? "var(--accent)"}} aria-hidden="true">
					<i/>
				</div>
			</aside>
		</Show>
	);
}
