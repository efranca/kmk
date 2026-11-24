import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import "../i18n";
import { ChoiceChip, ChoiceChips } from "./ChoiceChips";
import { Dialog } from "./Dialog";
import { Segmented } from "./Segmented";
import { ToastProvider } from "./Toast";
import { useToast } from "./toastContext";
import { Toggle } from "./Toggle";

describe("Dialog", () => {
  it("renders nothing when closed and a titled dialog when open", () => {
    const { rerender } = render(<Dialog open={false} title="Event" onClose={() => {}}>body</Dialog>);
    expect(screen.queryByText("body")).toBeNull();
    rerender(<Dialog open title="Event" onClose={() => {}}>body</Dialog>);
    expect(screen.getByRole("dialog", { name: "Event" })).toHaveTextContent("body");
  });
  it("closes with the close button and on Escape (cancel)", () => {
    const onClose = vi.fn();
    render(<Dialog open title="Event" onClose={onClose}>body</Dialog>);
    fireEvent.click(screen.getByRole("button", { name: "Fermer" }));
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe("Segmented", () => {
  it("marks the current option and reports a choice", () => {
    const onChange = vi.fn();
    render(<Segmented label="View" value="week" onChange={onChange} options={[{ value: "day", label: "Day" }, { value: "week", label: "Week" }]} />);
    expect(screen.getByRole("radio", { name: "Week" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Day" })).toHaveAttribute("aria-checked", "false");
    fireEvent.click(screen.getByRole("radio", { name: "Day" }));
    expect(onChange).toHaveBeenCalledWith("day");
  });
});

describe("Toggle and chips", () => {
  it("toggle is a switch", () => {
    const onChange = vi.fn();
    render(<Toggle label="All day" checked={false} onChange={onChange} />);
    fireEvent.click(screen.getByRole("switch", { name: "All day" }));
    expect(onChange).toHaveBeenCalled();
  });
  it("a chip reports its pressed state", () => {
    render(<ChoiceChips label="Weekdays"><ChoiceChip pressed>Mon</ChoiceChip><ChoiceChip pressed={false}>Tue</ChoiceChip></ChoiceChips>);
    expect(screen.getByRole("button", { name: "Mon" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("group", { name: "Weekdays" })).toBeInTheDocument();
  });
});

describe("Toast", () => {
  function Trigger({ onUndo }: { onUndo: () => void }) {
    const show = useToast();
    return <button onClick={() => show("Moved", { action: { label: "Undo", onClick: onUndo } })}>go</button>;
  }
  it("shows a message with an action that runs once and dismisses it", () => {
    const onUndo = vi.fn();
    render(<ToastProvider><Trigger onUndo={onUndo} /></ToastProvider>);
    fireEvent.click(screen.getByText("go"));
    expect(screen.getByText("Moved")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Moved")).toBeNull();
  });
  it("disappears by itself", () => {
    vi.useFakeTimers();
    render(<ToastProvider><Trigger onUndo={() => {}} /></ToastProvider>);
    fireEvent.click(screen.getByText("go"));
    act(() => { vi.advanceTimersByTime(9000); });
    expect(screen.queryByText("Moved")).toBeNull();
    vi.useRealTimers();
  });
  it("useToast outside the provider is an error", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Trigger onUndo={() => {}} />)).toThrow(/ToastProvider/);
    spy.mockRestore();
  });
});
