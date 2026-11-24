import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { mockApi, renderWithProviders, reply } from "../testUtils";
import { useSetTaskStatus, useTasks, useToggleTask } from "./hooks";
import type { Task } from "./types";

const base: Task = {
  id: 1, title: "Mop", description: null, icon: null, category_id: null, people: [], status: "pending", due_date: null,
  completed_at: null, show_on_dashboard: true, created_by: { id: 1, name: "A" }, updated_by: { id: 1, name: "A" }, created_at: "", updated_at: "",
};

const seen: string[] = [];

function Probe() {
  const list = useTasks("all");
  const toggle = useToggleTask();
  const task = list.data?.[0];
  if (task) seen.push(task.status);
  return task ? <button onClick={() => toggle.mutate(task)}>{`${task.title}:${task.status}`}</button> : <p>loading</p>;
}

afterEach(() => {
  vi.unstubAllGlobals();
  seen.length = 0;
});

describe("useToggleTask", () => {
  it("flips the task at once and keeps it when the server agrees", async () => {
    const done = { ...base, status: "completed", completed_at: "2026-11-24T15:00:00Z" };
    let current: Task = base;
    mockApi({
      "GET /api/tasks": () => ({ tasks: [current] }),
      "POST /api/tasks/1/complete": () => { current = done as Task; return { task: done }; },
    });
    renderWithProviders(<Probe />);
    fireEvent.click(await screen.findByText("Mop:pending"));
    expect(await screen.findByText("Mop:completed")).toBeInTheDocument();
    await waitFor(() => expect(seen[seen.length - 1]).toBe("completed"));
  });

  it("flips it back when the server refuses", async () => {
    let refuse!: () => void;
    const gate = new Promise<void>((resolve) => { refuse = resolve; });
    vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
      if (init?.method === "POST") { await gate; return reply(403, { error: "forbidden" }); }
      return reply(200, { tasks: [base] });
    }));
    renderWithProviders(<Probe />);
    fireEvent.click(await screen.findByText("Mop:pending"));
    expect(await screen.findByText("Mop:completed")).toBeInTheDocument(); // flipped while the server has not answered
    await act(async () => { refuse(); });
    await waitFor(() => expect(screen.getByText("Mop:pending")).toBeInTheDocument()); // and back after the refusal
  });
});

function MoveProbe() {
  const list = useTasks("all");
  const move = useSetTaskStatus();
  const task = list.data?.[0];
  return task ? <button onClick={() => move.mutate({ task, status: "in_progress" })}>{`${task.title}:${task.status}`}</button> : <p>loading</p>;
}

describe("useSetTaskStatus", () => {
  it("moves the task to in progress at once and posts /start", async () => {
    const started = { ...base, status: "in_progress" };
    let current: Task = base;
    const start = vi.fn(() => { current = started as Task; return { task: started }; });
    mockApi({ "GET /api/tasks": () => ({ tasks: [current] }), "POST /api/tasks/1/start": start });
    renderWithProviders(<MoveProbe />);
    fireEvent.click(await screen.findByText("Mop:pending"));
    expect(await screen.findByText("Mop:in_progress")).toBeInTheDocument();
    expect(start).toHaveBeenCalled();
  });

  it("puts the task back when the server refuses", async () => {
    let refuse!: () => void;
    const gate = new Promise<void>((resolve) => { refuse = resolve; });
    vi.stubGlobal("fetch", vi.fn(async (_input: string, init?: RequestInit) => {
      if (init?.method === "POST") { await gate; return reply(403, { error: "forbidden" }); }
      return reply(200, { tasks: [base] });
    }));
    renderWithProviders(<MoveProbe />);
    fireEvent.click(await screen.findByText("Mop:pending"));
    expect(await screen.findByText("Mop:in_progress")).toBeInTheDocument();
    await act(async () => { refuse(); });
    await waitFor(() => expect(screen.getByText("Mop:pending")).toBeInTheDocument());
  });
});
