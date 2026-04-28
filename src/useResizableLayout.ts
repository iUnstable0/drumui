import {createSignal} from "solid-js";
import {clamp} from "./utils/format";

type ResizeTarget = "library" | "inspector" | "kit";

const DEFAULTS = {
	libraryWidth: 244,
	inspectorWidth: 330,
	kitHeight: 360,
};

const LIMITS = {
	library: {min: 220, max: 360},
	inspector: {min: 260, max: 560},
	kit: {min: 220, max: 560},
};

export function useResizableLayout() {
	const [libraryWidth, setLibraryWidth] = createSignal(DEFAULTS.libraryWidth);
	const [inspectorWidth, setInspectorWidth] = createSignal(DEFAULTS.inspectorWidth);
	const [kitHeight, setKitHeight] = createSignal(DEFAULTS.kitHeight);
	const [libraryCollapsed, setLibraryCollapsed] = createSignal(false);
	const [inspectorCollapsed, setInspectorCollapsed] = createSignal(false);

	function beginResize(target: ResizeTarget, event: PointerEvent) {
		event.preventDefault();
		const startX = event.clientX;
		const startY = event.clientY;
		const startLibraryWidth = libraryWidth();
		const startInspectorWidth = inspectorWidth();
		const startKitHeight = kitHeight();

		const move = (moveEvent: PointerEvent) => {
			if (target === "library") {
				setLibraryWidth(clamp(startLibraryWidth + moveEvent.clientX - startX, LIMITS.library.min, LIMITS.library.max));
			} else if (target === "inspector") {
				setInspectorWidth(clamp(startInspectorWidth + startX - moveEvent.clientX, LIMITS.inspector.min, LIMITS.inspector.max));
			} else {
				setKitHeight(clamp(startKitHeight + moveEvent.clientY - startY, LIMITS.kit.min, LIMITS.kit.max));
			}
		};

		const stop = () => {
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", stop);
		};

		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", stop, {once: true});
	}

	function reset() {
		setLibraryWidth(DEFAULTS.libraryWidth);
		setInspectorWidth(DEFAULTS.inspectorWidth);
		setKitHeight(DEFAULTS.kitHeight);
		setLibraryCollapsed(false);
		setInspectorCollapsed(false);
	}

	return {
		libraryWidth,
		inspectorWidth,
		kitHeight,
		libraryCollapsed,
		inspectorCollapsed,
		toggleLibraryCollapsed: () => setLibraryCollapsed((collapsed) => !collapsed),
		toggleInspectorCollapsed: () => setInspectorCollapsed((collapsed) => !collapsed),
		beginResize,
		reset,
	};
}
