export function basename(path: string): string {
	const parts = path.split(/[/\\]/);
	return parts[parts.length - 1] || path;
}

export function clamp(value: number, min = 0, max = 1): number {
	return Math.max(min, Math.min(max, value));
}

export function formatTime(milliseconds: number): string {
	const safeMilliseconds = Number.isFinite(milliseconds) ? Math.max(0, milliseconds) : 0;
	const totalSeconds = Math.floor(safeMilliseconds / 1000);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function formatPercent(value: number): string {
	return `${Math.round(value * 100)}%`;
}

export function getErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

export function noteNameFromMidi(note: number): string {
	const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
	const octave = Math.floor(note / 12) - 1;
	return `${names[note % 12]}${octave}`;
}
