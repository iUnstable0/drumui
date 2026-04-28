import {For} from "solid-js";
import type {KeyboardShortcutHint} from "../keyboardShortcuts";

interface ShortcutKeycapProps {
	hint: KeyboardShortcutHint;
	class?: string;
}

export function ShortcutKeycap(props: ShortcutKeycapProps) {
	const keys = () => props.hint.label.split(/\s+/).filter(Boolean);

	return (
		<span class={props.class ? `shortcut-keycap ${props.class}` : "shortcut-keycap"} aria-hidden="true">
			<For each={keys()}>{(key) => <kbd>{key}</kbd>}</For>
		</span>
	);
}
