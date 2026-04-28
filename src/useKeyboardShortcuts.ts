import {onCleanup} from "solid-js";
import type {KitPieceId} from "./types";
import {resolveKeyboardShortcut} from "./keyboardShortcuts";

interface KeyboardShortcutHandlers {
	onAdjustActiveVolume: (delta: number) => void;
	onFocusLane: (direction: -1 | 1) => void;
	onNudgePlayback: (direction: -1 | 1) => void;
	onPadPress: (pieceId: KitPieceId) => void;
	onPadRelease: (pieceId: KitPieceId) => void;
	onRestart: () => void;
	onStop: () => void;
	onToggleClick: () => void;
	onToggleCountIn: () => void;
	onToggleActiveMute: () => void;
	onToggleActiveSolo: () => void;
	onToggleLoop: () => void;
	onTogglePlayback: () => void | Promise<void>;
}

const SHORTCUT_IGNORE_SELECTOR = [
	"a[href]",
	"button",
	"input",
	"select",
	"textarea",
	"[contenteditable='']",
	"[contenteditable='true']",
	"[data-shortcuts-ignore]",
	"[role='slider']",
	"[role='spinbutton']",
	"[role='textbox']",
].join(",");

function shouldIgnoreShortcutTarget(target: EventTarget | null): boolean {
	if (!(target instanceof Element)) return false;
	return Boolean(target.closest(SHORTCUT_IGNORE_SELECTOR));
}

export function useKeyboardShortcuts(handlers: KeyboardShortcutHandlers) {
	const pressedPads = new Map<string, KitPieceId>();

	function handleKeyDown(event: KeyboardEvent) {
		if (shouldIgnoreShortcutTarget(event.target)) return;

		const command = resolveKeyboardShortcut(event);
		if (!command) return;

		event.preventDefault();
		if (!command.repeatable && event.repeat) return;

		switch (command.type) {
			case "adjustVolume":
				handlers.onAdjustActiveVolume(command.delta);
				break;
			case "focusLane":
				handlers.onFocusLane(command.direction);
				break;
			case "nudgePlayback":
				handlers.onNudgePlayback(command.direction);
				break;
			case "restart":
				handlers.onRestart();
				break;
			case "stop":
				handlers.onStop();
				break;
			case "toggleClick":
				handlers.onToggleClick();
				break;
			case "toggleCountIn":
				handlers.onToggleCountIn();
				break;
			case "toggleLoop":
				handlers.onToggleLoop();
				break;
			case "toggleMute":
				handlers.onToggleActiveMute();
				break;
			case "togglePlayback":
				void handlers.onTogglePlayback();
				break;
			case "toggleSolo":
				handlers.onToggleActiveSolo();
				break;
			case "triggerPad":
				pressedPads.set(event.code, command.pieceId);
				handlers.onPadPress(command.pieceId);
				break;
		}
	}

	function handleKeyUp(event: KeyboardEvent) {
		const pieceId = pressedPads.get(event.code);
		if (!pieceId) return;

		event.preventDefault();
		pressedPads.delete(event.code);
		handlers.onPadRelease(pieceId);
	}

	function releasePressedPads() {
		for (const pieceId of pressedPads.values()) handlers.onPadRelease(pieceId);
		pressedPads.clear();
	}

	window.addEventListener("keydown", handleKeyDown);
	window.addEventListener("keyup", handleKeyUp);
	window.addEventListener("blur", releasePressedPads);

	onCleanup(() => {
		releasePressedPads();
		window.removeEventListener("keydown", handleKeyDown);
		window.removeEventListener("keyup", handleKeyUp);
		window.removeEventListener("blur", releasePressedPads);
	});
}
