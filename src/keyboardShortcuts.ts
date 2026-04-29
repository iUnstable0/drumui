import type { KitPieceId } from "./types";

export type KeyboardShortcutCommand =
	| { type: "adjustVolume"; delta: number; repeatable: true }
	| { type: "focusLane"; direction: -1 | 1; repeatable: true }
	| { type: "nudgePlayback"; direction: -1 | 1; repeatable: true }
	| { type: "restart"; repeatable: false }
	| { type: "stop"; repeatable: false }
	| { type: "toggleClick"; repeatable: false }
	| { type: "toggleCountIn"; repeatable: false }
	| { type: "toggleLoop"; repeatable: false }
	| { type: "toggleMute"; repeatable: false }
	| { type: "togglePlayback"; repeatable: false }
	| { type: "toggleSolo"; repeatable: false }
	| { type: "triggerPad"; pieceId: KitPieceId; repeatable: false };

export interface KeyboardShortcutEventLike {
	code: string;
	altKey?: boolean;
	ctrlKey?: boolean;
	metaKey?: boolean;
	shiftKey?: boolean;
}

export interface KeyboardShortcutHint {
	label: string;
	aria: string;
}

export const KEYBOARD_DRUM_TRIGGER_MAP: Readonly<Record<string, KitPieceId>> = {
	KeyZ: "kick",
	KeyX: "snare",
	KeyC: "clap",
	KeyV: "closedHat",
	KeyB: "openHat",
	KeyA: "midTom",
	KeyS: "lowTom",
	KeyD: "crash",
	KeyF: "ride",
};

export const KEYBOARD_DRUM_TRIGGER_HINTS: Readonly<Record<KitPieceId, KeyboardShortcutHint>> = {
	kick: { label: "Z", aria: "Z" },
	snare: { label: "X", aria: "X" },
	clap: { label: "C", aria: "C" },
	closedHat: { label: "V", aria: "V" },
	openHat: { label: "B", aria: "B" },
	midTom: { label: "A", aria: "A" },
	lowTom: { label: "S", aria: "S" },
	crash: { label: "D", aria: "D" },
	ride: { label: "F", aria: "F" },
};

export const KEYBOARD_SHORTCUT_HINTS = {
	adjustVolumeDown: { label: "-  [", aria: "- or [" },
	adjustVolumeUp: { label: "+  ]", aria: "+ or ]" },
	focusLane: { label: "↑ ↓", aria: "ArrowUp ArrowDown" },
	nudgePlayback: { label: "← →", aria: "ArrowLeft ArrowRight" },
	restart: { label: "Enter", aria: "Enter" },
	stop: { label: "⌫ Del", aria: "Backspace Delete" },
	toggleClick: { label: "K", aria: "K" },
	toggleCountIn: { label: "I", aria: "I" },
	toggleLoop: { label: "L", aria: "L" },
	toggleMute: { label: "M", aria: "M" },
	togglePlayback: { label: "Space", aria: "Space" },
	toggleSolo: { label: "Shift S", aria: "Shift+S" },
} as const satisfies Readonly<Record<string, KeyboardShortcutHint>>;

export const KEYBOARD_VOLUME_STEP = 0.05;

export function resolveKeyboardShortcut(event: KeyboardShortcutEventLike): KeyboardShortcutCommand | null {
	if (event.altKey || event.ctrlKey || event.metaKey) return null;

	switch (event.code) {
		case "Space":
			return { type: "togglePlayback", repeatable: false };
		case "Enter":
		case "NumpadEnter":
			return { type: "restart", repeatable: false };
		case "Backspace":
		case "Delete":
			return { type: "stop", repeatable: false };
		case "ArrowLeft":
			return { type: "nudgePlayback", direction: -1, repeatable: true };
		case "ArrowRight":
			return { type: "nudgePlayback", direction: 1, repeatable: true };
		case "ArrowUp":
			return { type: "focusLane", direction: -1, repeatable: true };
		case "ArrowDown":
			return { type: "focusLane", direction: 1, repeatable: true };
		case "KeyL":
			return { type: "toggleLoop", repeatable: false };
		case "KeyK":
			return { type: "toggleClick", repeatable: false };
		case "KeyI":
			return { type: "toggleCountIn", repeatable: false };
		case "KeyM":
			return { type: "toggleMute", repeatable: false };
		case "Equal":
		case "BracketRight":
		case "NumpadAdd":
			return { type: "adjustVolume", delta: KEYBOARD_VOLUME_STEP, repeatable: true };
		case "Minus":
		case "BracketLeft":
		case "NumpadSubtract":
			return { type: "adjustVolume", delta: -KEYBOARD_VOLUME_STEP, repeatable: true };
		case "KeyS":
			if (event.shiftKey) return { type: "toggleSolo", repeatable: false };
			break;
	}

	const pieceId = KEYBOARD_DRUM_TRIGGER_MAP[event.code];
	return pieceId ? { type: "triggerPad", pieceId, repeatable: false } : null;
}

export function resolveKeyboardPadRelease(event: KeyboardShortcutEventLike): KitPieceId | null {
	if (event.altKey || event.ctrlKey || event.metaKey) return null;
	if (event.shiftKey && event.code === "KeyS") return null;
	return KEYBOARD_DRUM_TRIGGER_MAP[event.code] ?? null;
}
