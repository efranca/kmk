import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useTasksView } from "./useTasksView";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("useTasksView", () => {
  it("starts as the list, also for unknown values", () => {
    localStorage.setItem("kmk.tasks.view", "tiles");
    expect(renderHook(() => useTasksView()).result.current[0]).toBe("list");
  });
  it("remembers the board", () => {
    const { result } = renderHook(() => useTasksView());
    act(() => result.current[1]("board"));
    expect(result.current[0]).toBe("board");
    expect(localStorage.getItem("kmk.tasks.view")).toBe("board");
    expect(renderHook(() => useTasksView()).result.current[0]).toBe("board");
  });
  it("survives storage that throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("no"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("no"); });
    const { result } = renderHook(() => useTasksView());
    act(() => result.current[1]("board"));
    expect(result.current[0]).toBe("board");
  });
});
