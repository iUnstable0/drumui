import {Drum, FileUp, Gauge, Lightbulb} from "lucide-solid";

interface EmptyStateProps {
	dragOver: boolean;
	isLoading: boolean;
	onPick: () => void;
}

export function EmptyState(props: EmptyStateProps) {
	return (
		<section
			class="empty-state"
			classList={{"is-drag-over": props.dragOver}}
			role="button"
			tabIndex={0}
			onClick={props.onPick}
			onKeyDown={(event) => {
				if (event.key === "Enter" || event.key === " ") props.onPick();
			}}
		>
			<div class="empty-state__icon">
				<Drum strokeWidth={1.6}/>
			</div>
			<h2>{props.isLoading ? "Reading MIDI" : "Drop a MIDI file"}</h2>
			<p>Load a `.mid` file and play it with the Analog 808 kit.</p>
			<div class="empty-state__features">
				<span><FileUp/> Import</span>
				<span><Gauge/> Speed</span>
				<span><Lightbulb/> Light preview</span>
			</div>
		</section>
	);
}
