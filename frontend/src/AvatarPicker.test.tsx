import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AvatarPicker from "./AvatarPicker";
import frCA from "./locales/fr-CA.json";
import { reply } from "./testUtils";

vi.mock("./ui/prepareAvatar", async (orig) => ({
  ...(await orig<typeof import("./ui/prepareAvatar")>()),
  prepareAvatar: vi.fn(async (f: File) => {
    if (f.type !== "image/png") throw new Error("invalid_image");
    return new Blob([new Uint8Array(10)], { type: "image/jpeg" });
  }),
}));

const person = { id: 1, name: "Alice Roy", color: "teal" as const };
const choose = (file: File) => fireEvent.change(screen.getByLabelText(frCA.avatarChoose, { selector: "input" }), { target: { files: [file] } });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => reply(204));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("AvatarPicker", () => {
  it("uploads the prepared picture and tells the page", async () => {
    const onChanged = vi.fn();
    render(<AvatarPicker person={person} csrfToken="tok" onChanged={onChanged} />);
    choose(new File(["x"], "me.png", { type: "image/png" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/me/avatar");
    expect(init.method).toBe("PUT");
    expect((init.headers as Record<string, string>)["X-CSRF-Token"]).toBe("tok");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("image/jpeg");
  });

  it("shows an error for a file that is not a usable picture and sends nothing", async () => {
    render(<AvatarPicker person={person} csrfToken="tok" onChanged={vi.fn()} />);
    choose(new File(["x"], "x.txt", { type: "text/plain" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(frCA.avatarInvalid);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the server's refusal", async () => {
    fetchMock.mockResolvedValueOnce(reply(422, { error: "invalid_image" }));
    render(<AvatarPicker person={person} csrfToken="tok" onChanged={vi.fn()} />);
    choose(new File(["x"], "me.png", { type: "image/png" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(frCA.avatarInvalid);
  });

  it("offers Remove only when there is a picture, and removes it", async () => {
    const onChanged = vi.fn();
    const { rerender } = render(<AvatarPicker person={person} csrfToken="tok" onChanged={onChanged} />);
    expect(screen.queryByRole("button", { name: frCA.avatarRemove })).toBeNull();
    rerender(<AvatarPicker person={{ ...person, avatar_url: "/api/people/1/avatar?v=1" }} csrfToken="tok" onChanged={onChanged} />);
    fireEvent.click(screen.getByRole("button", { name: frCA.avatarRemove }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect([url, init.method]).toEqual(["/api/me/avatar", "DELETE"]);
  });
});
