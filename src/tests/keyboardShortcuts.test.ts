import { describe, expect, it } from "vitest";
import {
	KEYBOARD_DRUM_TRIGGER_HINTS,
	KEYBOARD_DRUM_TRIGGER_MAP,
	KEYBOARD_SHORTCUT_HINTS,
	KEYBOARD_VOLUME_STEP,
	resolveKeyboardPadRelease,
	resolveKeyboardShortcut,
} from "../keyboardShortcuts";

describe("keyboard shortcuts", () => {
	it("resolves transport controls as one-shot commands", () => {
		expect(resolveKeyboardShortcut({ code: "Space" })).toEqual({ type: "togglePlayback", repeatable: false });
		expect(resolveKeyboardShortcut({ code: "Enter" })).toEqual({ type: "restart", repeatable: false });
		expect(resolveKeyboardShortcut({ code: "NumpadEnter" })).toEqual({ type: "restart", repeatable: false });
		expect(resolveKeyboardShortcut({ code: "Backspace" })).toEqual({ type: "stop", repeatable: false });
		expect(resolveKeyboardShortcut({ code: "Delete" })).toEqual({ type: "stop", repeatable: false });
	});

	it("maps the QWERTY drum cluster to kit pieces", () => {
		expect(KEYBOARD_DRUM_TRIGGER_MAP).toMatchObject({
			KeyZ: "kick",
			KeyX: "snare",
			KeyC: "clap",
			KeyV: "closedHat",
			KeyB: "openHat",
			KeyA: "midTom",
			KeyS: "lowTom",
			KeyD: "crash",
			KeyF: "ride",
		});
		expect(resolveKeyboardShortcut({ code: "KeyZ" })).toEqual({
			type: "triggerPad",
			pieceId: "kick",
			repeatable: false,
		});
		expect(resolveKeyboardShortcut({ code: "KeyF" })).toEqual({
			type: "triggerPad",
			pieceId: "ride",
			repeatable: false,
		});
	});

	it("keeps displayed drum key labels in sync with the resolver mapping", () => {
		for (const [code, pieceId] of Object.entries(KEYBOARD_DRUM_TRIGGER_MAP)) {
			const keyLabel = code.replace("Key", "");
			expect(KEYBOARD_DRUM_TRIGGER_HINTS[pieceId].label).toBe(keyLabel);
			expect(resolveKeyboardShortcut({ code })).toEqual({ type: "triggerPad", pieceId, repeatable: false });
		}
	});

	it("keeps C as clap and K as the click toggle", () => {
		expect(resolveKeyboardShortcut({ code: "KeyC" })).toEqual({
			type: "triggerPad",
			pieceId: "clap",
			repeatable: false,
		});
		expect(resolveKeyboardShortcut({ code: "KeyK" })).toEqual({ type: "toggleClick", repeatable: false });
	});

	it("uses I for count-in without conflicting with the drum cluster", () => {
		expect(resolveKeyboardShortcut({ code: "KeyI" })).toEqual({ type: "toggleCountIn", repeatable: false });
	});

	it("reserves Shift+S for solo while plain S remains a drum trigger", () => {
		expect(resolveKeyboardShortcut({ code: "KeyS" })).toEqual({
			type: "triggerPad",
			pieceId: "lowTom",
			repeatable: false,
		});
		expect(resolveKeyboardShortcut({ code: "KeyS", shiftKey: true })).toEqual({
			type: "toggleSolo",
			repeatable: false,
		});
		expect(resolveKeyboardPadRelease({ code: "KeyS", shiftKey: true })).toBeNull();
	});

	it("classifies navigation and volume controls as repeatable commands", () => {
		expect(resolveKeyboardShortcut({ code: "ArrowLeft" })).toEqual({
			type: "nudgePlayback",
			direction: -1,
			repeatable: true,
		});
		expect(resolveKeyboardShortcut({ code: "ArrowRight" })).toEqual({
			type: "nudgePlayback",
			direction: 1,
			repeatable: true,
		});
		expect(resolveKeyboardShortcut({ code: "ArrowUp" })).toEqual({
			type: "focusLane",
			direction: -1,
			repeatable: true,
		});
		expect(resolveKeyboardShortcut({ code: "ArrowDown" })).toEqual({
			type: "focusLane",
			direction: 1,
			repeatable: true,
		});
		expect(resolveKeyboardShortcut({ code: "Equal" })).toEqual({
			type: "adjustVolume",
			delta: KEYBOARD_VOLUME_STEP,
			repeatable: true,
		});
		expect(resolveKeyboardShortcut({ code: "BracketLeft" })).toEqual({
			type: "adjustVolume",
			delta: -KEYBOARD_VOLUME_STEP,
			repeatable: true,
		});
	});

	it("ignores shortcuts combined with system modifiers", () => {
		expect(resolveKeyboardShortcut({ code: "Space", metaKey: true })).toBeNull();
		expect(resolveKeyboardShortcut({ code: "KeyL", ctrlKey: true })).toBeNull();
		expect(resolveKeyboardShortcut({ code: "KeyZ", altKey: true })).toBeNull();
	});

	it("keeps displayed command labels in sync with shortcut behavior", () => {
		expect(KEYBOARD_SHORTCUT_HINTS.togglePlayback.label).toBe("Space");
		expect(resolveKeyboardShortcut({ code: "Space" })?.type).toBe("togglePlayback");
		expect(KEYBOARD_SHORTCUT_HINTS.restart.label).toBe("Enter");
		expect(resolveKeyboardShortcut({ code: "Enter" })?.type).toBe("restart");
		expect(KEYBOARD_SHORTCUT_HINTS.stop.label).toBe("⌫ Del");
		expect(resolveKeyboardShortcut({ code: "Backspace" })?.type).toBe("stop");
		expect(resolveKeyboardShortcut({ code: "Delete" })?.type).toBe("stop");
		expect(KEYBOARD_SHORTCUT_HINTS.toggleLoop.label).toBe("L");
		expect(resolveKeyboardShortcut({ code: "KeyL" })?.type).toBe("toggleLoop");
		expect(KEYBOARD_SHORTCUT_HINTS.toggleClick.label).toBe("K");
		expect(resolveKeyboardShortcut({ code: "KeyK" })?.type).toBe("toggleClick");
		expect(KEYBOARD_SHORTCUT_HINTS.toggleCountIn.label).toBe("I");
		expect(resolveKeyboardShortcut({ code: "KeyI" })?.type).toBe("toggleCountIn");
		expect(KEYBOARD_SHORTCUT_HINTS.toggleMute.label).toBe("M");
		expect(resolveKeyboardShortcut({ code: "KeyM" })?.type).toBe("toggleMute");
		expect(KEYBOARD_SHORTCUT_HINTS.toggleSolo.label).toBe("Shift S");
		expect(resolveKeyboardShortcut({ code: "KeyS", shiftKey: true })?.type).toBe("toggleSolo");
		expect(KEYBOARD_SHORTCUT_HINTS.nudgePlayback.label).toBe("← →");
		expect(resolveKeyboardShortcut({ code: "ArrowLeft" })?.type).toBe("nudgePlayback");
		expect(resolveKeyboardShortcut({ code: "ArrowRight" })?.type).toBe("nudgePlayback");
		expect(KEYBOARD_SHORTCUT_HINTS.focusLane.label).toBe("↑ ↓");
		expect(resolveKeyboardShortcut({ code: "ArrowUp" })?.type).toBe("focusLane");
		expect(resolveKeyboardShortcut({ code: "ArrowDown" })?.type).toBe("focusLane");
		expect(resolveKeyboardShortcut({ code: "Equal" })?.type).toBe("adjustVolume");
		expect(resolveKeyboardShortcut({ code: "BracketLeft" })?.type).toBe("adjustVolume");
	});
});
