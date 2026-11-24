import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_PREFERENCES, PreferencesProvider, usePreferences } from "./preferences";
import { reply } from "./testUtils";

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

function Probe() {
  const { prefs, update } = usePreferences();
  return (
    <>
      <p data-testid="out">{`${prefs.theme}|${prefs.tasks_view}|${prefs.dashboard_widgets.my_tasks}|${prefs.dashboard_widgets.my_events}`}</p>
      <button onClick={() => update({ theme: "dark" })}>dark</button>
      <button onClick={() => update({ dashboard_widgets: { my_tasks: false } })}>hide</button>
    </>
  );
}
const show = () => render(<PreferencesProvider initial={DEFAULT_PREFERENCES} csrfToken="tok"><Probe /></PreferencesProvider>);

describe("preferences", () => {
  it("applies a change at once and sends it to the server with the CSRF token", async () => {
    const fetchMock = vi.fn(async () => reply(200, { preferences: { ...DEFAULT_PREFERENCES, theme: "dark" } }));
    vi.stubGlobal("fetch", fetchMock);
    show();
    fireEvent.click(screen.getByText("dark"));
    expect(screen.getByTestId("out")).toHaveTextContent("dark|list");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("kmk.theme")).toBe("dark");
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/me/preferences");
    expect(init.method).toBe("PATCH");
    expect((init.headers as Record<string, string>)["X-CSRF-Token"]).toBe("tok");
    expect(JSON.parse(String(init.body))).toEqual({ theme: "dark" });
  });

  it("merges a partial widgets change", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(200, { preferences: DEFAULT_PREFERENCES })));
    show();
    fireEvent.click(screen.getByText("hide"));
    expect(screen.getByTestId("out")).toHaveTextContent("kmk|list|false|true");
  });

  it("rolls back when the server refuses", async () => {
    let refuse!: () => void;
    const gate = new Promise<void>((r) => { refuse = r; });
    vi.stubGlobal("fetch", vi.fn(async () => { await gate; return reply(422, { error: "invalid" }); }));
    show();
    fireEvent.click(screen.getByText("dark"));
    expect(screen.getByTestId("out")).toHaveTextContent("dark|list");
    await act(async () => { refuse(); });
    await waitFor(() => expect(screen.getByTestId("out")).toHaveTextContent("kmk|list"));
    expect(document.documentElement.dataset.theme).toBe("kmk");
  });

  it("fills defaults for missing keys of what the server sent", () => {
    render(<PreferencesProvider initial={{ theme: "light" } as never} csrfToken="t"><Probe /></PreferencesProvider>);
    expect(screen.getByTestId("out")).toHaveTextContent("light|list|true|true");
  });

  it("keeps a newer successful change when an older one fails afterwards", async () => {
    let failFirst!: () => void;
    const first = new Promise<void>((r) => { failFirst = r; });
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      calls += 1;
      if (calls === 1) { await first; return reply(422, { error: "invalid" }); }
      return reply(200, { preferences: DEFAULT_PREFERENCES });
    }));
    const Both = () => {
      const { prefs, update } = usePreferences();
      return (
        <>
          <p data-testid="t">{prefs.theme}</p>
          <p data-testid="w">{`${prefs.dashboard_widgets.my_events}|${prefs.dashboard_widgets.all_events}`}</p>
          <button onClick={() => { update({ theme: "dark" }); update({ theme: "light" }); }}>themes</button>
          <button onClick={() => { update({ dashboard_widgets: { my_events: false } }); update({ dashboard_widgets: { all_events: false } }); }}>widgets</button>
        </>
      );
    };
    render(<PreferencesProvider initial={DEFAULT_PREFERENCES} csrfToken="t"><Both /></PreferencesProvider>);
    fireEvent.click(screen.getByText("themes"));
    await act(async () => { failFirst(); });
    await waitFor(() => expect(calls).toBe(2));
    expect(screen.getByTestId("t")).toHaveTextContent("light"); // the older failure must not bring back "kmk"

    // the same for two toggles of the widgets object: only the failed one comes back
    calls = 0;
    const second = new Promise<void>((r) => { failFirst = r; });
    vi.stubGlobal("fetch", vi.fn(async () => {
      calls += 1;
      if (calls === 1) { await second; return reply(422, { error: "invalid" }); }
      return reply(200, { preferences: DEFAULT_PREFERENCES });
    }));
    fireEvent.click(screen.getByText("widgets"));
    await act(async () => { failFirst(); });
    await waitFor(() => expect(screen.getByTestId("w")).toHaveTextContent("true|false"));
  });
});
