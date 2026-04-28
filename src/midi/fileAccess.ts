import {open} from "@tauri-apps/plugin-dialog";

export function isTauriRuntime(): boolean {
	if (typeof window === "undefined") return false;
	return (window as unknown as {__TAURI_INTERNALS__?: unknown}).__TAURI_INTERNALS__ !== undefined;
}

export async function pickMidiPath(): Promise<string | null> {
	if (!isTauriRuntime()) return null;

	const selected = await open({
		multiple: false,
		directory: false,
		filters: [{name: "MIDI", extensions: ["mid", "midi"]}],
	});

	return typeof selected === "string" ? selected : null;
}
