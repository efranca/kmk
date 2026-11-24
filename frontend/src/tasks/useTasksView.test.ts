import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_PREFERENCES } from "../preferences";
import { preferencesWrapper } from "../testUtils";
import { useTasksView } from "./useTasksView";

afterEach(() => vi.unstubAllGlobals());

describe("useTasksView", () => {
  it("starts as the list", () => {
    expect(renderHook(() => useTasksView(), { wrapper: preferencesWrapper() }).result.current[0]).toBe("list");
  });
  it("starts as the board when the account says so", () => {
    const wrapper = preferencesWrapper({ ...DEFAULT_PREFERENCES, tasks_view: "board" });
    expect(renderHook(() => useTasksView(), { wrapper }).result.current[0]).toBe("board");
  });
  it("changes with the preference", () => {
    const { result } = renderHook(() => useTasksView(), { wrapper: preferencesWrapper() });
    act(() => result.current[1]("board"));
    expect(result.current[0]).toBe("board");
  });
});
