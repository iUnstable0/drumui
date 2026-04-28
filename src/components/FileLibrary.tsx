import {CircleAlert, FileAudio, FolderOpen, PanelLeftClose, PanelLeftOpen, X} from "lucide-solid";
import {Show} from "solid-js";
import type {ParsedMidi} from "../types";
import {basename, formatTime} from "../utils/format";

interface FileLibraryProps {
	session: ParsedMidi | null;
	fileLabel: string | null;
	error: string | null;
	isLoading: boolean;
	collapsed: boolean;
	onToggleCollapse: () => void;
	onPick: () => void;
	onClear: () => void;
}

export function FileLibrary(props: FileLibraryProps) {
	return (
		<Show
			when={props.collapsed}
			fallback={
				<aside class="library-panel">
					<div class="panel-heading">
						<h2>Library</h2>
						<div class="panel-heading__actions">
							<button class="panel-icon-button" aria-label="Collapse library" onClick={props.onToggleCollapse}>
								<PanelLeftClose/>
							</button>
							<button class="text-button" onClick={props.onPick} disabled={props.isLoading}>
								<FolderOpen/>
								Import
							</button>
						</div>
					</div>

					<Show
						when={props.session}
						fallback={
							<div class="library-empty">
								<FileAudio/>
								<p>No MIDI loaded</p>
							</div>
						}
					>
						{(session) => (
							<div class="file-summary">
								<div class="file-card">
									<FileAudio class="file-card__icon"/>
									<div>
										<h3 title={props.fileLabel ?? session().label}>{basename(props.fileLabel ?? session().label)}</h3>
										<p>{formatTime(session().durationMs)} · {Math.round(session().bpm)} BPM · {session().hits.length} hits</p>
									</div>
									<button class="file-card__clear" onClick={props.onClear} aria-label="Clear MIDI">
										<X/>
									</button>
								</div>
							</div>
						)}
					</Show>

					<Show when={props.error}>
						<div class="notice is-warning">
							<CircleAlert/>
							<span>{props.error}</span>
						</div>
					</Show>
				</aside>
			}
		>
			<aside class="library-panel panel-rail" aria-label="Library collapsed">
				<button class="panel-rail__button" aria-label="Expand library" onClick={props.onToggleCollapse}>
					<PanelLeftOpen/>
				</button>
				<button class="panel-rail__button" aria-label="Import MIDI" disabled={props.isLoading} onClick={props.onPick}>
					<FolderOpen/>
				</button>
			</aside>
		</Show>
	);
}
