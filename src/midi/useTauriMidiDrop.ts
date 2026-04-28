import {getCurrentWebview} from "@tauri-apps/api/webview";
import {onCleanup, onMount} from "solid-js";
import {isTauriRuntime} from "./fileAccess";

export function useTauriMidiDrop(onDrop: (path: string) => void, setDragOver: (value: boolean) => void) {
	onMount(() => {
		if (!isTauriRuntime()) return;

		let unlisten: (() => void) | undefined;
		try {
			getCurrentWebview()
				.onDragDropEvent((event) => {
					const type = event.payload.type;
					if (type === "enter" || type === "over") {
						setDragOver(true);
					} else if (type === "leave") {
						setDragOver(false);
					} else if (type === "drop") {
						setDragOver(false);
						const path = event.payload.paths.find((candidate) => /\.(mid|midi)$/i.test(candidate));
						if (path) onDrop(path);
					}
				})
				.then((cleanup) => {
					unlisten = cleanup;
				})
				.catch(() => undefined);
		} catch {
			return;
		}

		onCleanup(() => unlisten?.());
	});
}
