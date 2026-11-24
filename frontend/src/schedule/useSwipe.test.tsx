import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useSwipe } from "./useSwipe";

function Box({ prev, next }: { prev: () => void; next: () => void }) {
  return <div data-testid="box" {...useSwipe(prev, next)}><span className="grid__event" data-testid="ev" /></div>;
}
const swipe = (el: Element, from: [number, number], to: [number, number]) => {
  fireEvent.touchStart(el, { touches: [{ clientX: from[0], clientY: from[1] }] });
  fireEvent.touchEnd(el, { changedTouches: [{ clientX: to[0], clientY: to[1] }] });
};

describe("useSwipe", () => {
  it("left goes next, right goes previous", () => {
    const prev = vi.fn(), next = vi.fn();
    render(<Box prev={prev} next={next} />);
    swipe(screen.getByTestId("box"), [200, 100], [100, 105]);
    expect(next).toHaveBeenCalledOnce();
    swipe(screen.getByTestId("box"), [100, 100], [200, 100]);
    expect(prev).toHaveBeenCalledOnce();
  });
  it("ignores scrolling, short moves and swipes that start on an event", () => {
    const prev = vi.fn(), next = vi.fn();
    render(<Box prev={prev} next={next} />);
    swipe(screen.getByTestId("box"), [100, 100], [60, 300]);
    swipe(screen.getByTestId("box"), [100, 100], [70, 100]);
    swipe(screen.getByTestId("ev"), [200, 100], [50, 100]);
    expect(prev).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });
});
