import { describe, expect, it } from "vitest";
import { createActiveLane, moveActiveLane } from "../laneTargeting";

describe("active lane targeting", () => {
	it("starts arrow navigation from the pointer-selected lane", () => {
		const hovered = createActiveLane("openHat", "pointer");
		const moved = moveActiveLane(hovered, 1);
		expect(moved).toEqual({ pieceId: "lowTom", inputSource: "keyboard" });
	});

	it("keeps keyboard mixer commands on the latest active lane", () => {
		const hovered = createActiveLane("openHat", "pointer");
		const keyboardTarget = moveActiveLane(hovered, 1);
		expect(keyboardTarget.pieceId).toBe("lowTom");
		expect(keyboardTarget.pieceId).not.toBe(hovered.pieceId);
	});

	it("allows pointer movement to reclaim the active lane after keyboard navigation", () => {
		const keyboardTarget = moveActiveLane(createActiveLane("openHat", "pointer"), 1);
		const pointerTarget = createActiveLane("kick", "pointer");
		expect(keyboardTarget).toEqual({ pieceId: "lowTom", inputSource: "keyboard" });
		expect(pointerTarget).toEqual({ pieceId: "kick", inputSource: "pointer" });
	});

	it("clamps arrow navigation at the first and last lanes", () => {
		expect(moveActiveLane(createActiveLane("kick", "pointer"), -1)).toEqual({
			pieceId: "kick",
			inputSource: "keyboard",
		});
		expect(moveActiveLane(createActiveLane("ride", "pointer"), 1)).toEqual({
			pieceId: "ride",
			inputSource: "keyboard",
		});
	});
});
