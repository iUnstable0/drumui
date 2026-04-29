import * as Tooltip from "@kobalte/core/tooltip";
import type { JSX } from "solid-js";
import { Show } from "solid-js";
import type { KeyboardShortcutHint } from "../keyboardShortcuts";
import { ShortcutKeycap } from "./ShortcutKeycap";

interface IconButtonProps {
	label: string;
	shortcut?: KeyboardShortcutHint;
	disabled?: boolean;
	active?: boolean;
	tone?: "default" | "primary" | "danger";
	onClick: () => void;
	children: JSX.Element;
}

export function IconButton(props: IconButtonProps) {
	return (
		<Tooltip.Root openDelay={350}>
			<Tooltip.Trigger
				as="button"
				class="icon-button"
				classList={{
					"is-active": props.active,
					"is-primary": props.tone === "primary",
					"is-danger": props.tone === "danger",
				}}
				disabled={props.disabled}
				aria-keyshortcuts={props.shortcut?.aria}
				aria-label={props.shortcut ? `${props.label} (${props.shortcut.label})` : props.label}
				onClick={props.onClick}
			>
				{props.children}
			</Tooltip.Trigger>
			<Tooltip.Portal>
				<Tooltip.Content class="tooltip">
					<span>{props.label}</span>
					<Show when={props.shortcut}>
						{(shortcut) => <ShortcutKeycap hint={shortcut()} class="shortcut-keycap--tooltip" />}
					</Show>
					<Tooltip.Arrow class="tooltip-arrow" />
				</Tooltip.Content>
			</Tooltip.Portal>
		</Tooltip.Root>
	);
}
