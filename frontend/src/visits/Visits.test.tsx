import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import en from "../locales/en.json";
import { addDays, COMPANY_TIME_ZONE, todayIn } from "../schedule/scheduleDates";
import { mockApi, renderWithProviders, reply, resetLanguage, testUser, useEnglish } from "../testUtils";
import type { Visit } from "./api";
import { VisitsTodayPage } from "./VisitsTodayPage";

vi.mock("./preparePhoto", () => ({ preparePhoto: vi.fn(async () => new Blob([new Uint8Array(10)], { type: "image/webp" })) }));

const today = todayIn(COMPANY_TIME_ZONE);
const yesterday = addDays(today, -1);
const inOneHour = () => new Date(Date.now() + 3_600_000).toISOString();
const anHourAgo = () => new Date(Date.now() - 3_600_000).toISOString();

const alice = { user_id: 1, name: "Alice Roy" };
const bruno = { user_id: 2, name: "Bruno" };
const carla = { user_id: 3, name: "Carla" };
const here = (who: { user_id: number; name: string }, by = who.name, at = "2026-11-28T13:02:00+00:00") =>
  ({ ...who, checked_in_at: at, checked_in_by_name: by, self: by === who.name });

const visit = (over: Partial<Visit> = {}): Visit => ({
  id: 10, event_id: 3, occurrence_date: today, date: today, title: "Ménage", client_name: "Ducarme", property_name: "Beach house", property_id: 4,
  photos_required: false, rooms: [{ id: 1, name: "Kitchen" }, { id: 2, name: "Bathroom" }], state: "in_progress",
  people: [here(alice)], listed: [alice, bruno, carla], closed_at: null, closed_by_name: null, closed_without_photos: false, corrected: false,
  photos: [], photo_count_total: 0, skips: [], corrections: [], can_correct_until: inOneHour(), ...over,
});
const notStarted = (over: Partial<Visit> = {}) => visit({ id: null, state: "not_started", people: [], ...over });
const closed = (over: Partial<Visit> = {}) => visit({ state: "closed", closed_at: "2026-11-28T16:30:00+00:00", closed_by_name: "Alice Roy", ...over });

const base = `/api/visits/3/${today}`;
const admin = { session: { user: { ...testUser, role: "admin" as const } } };

function page(visits: Visit[], extra: Record<string, unknown> = {}, options = {}) {
  const api = mockApi({ "GET /api/visits/today": { visits }, ...extra } as Parameters<typeof mockApi>[0]);
  renderWithProviders(<VisitsTodayPage />, options);
  return api;
}
const card = async (title = "Ménage") => within(await screen.findByRole("article", { name: new RegExp(title) }));

/** A stand-in for XMLHttpRequest (the photo upload): answers each send with the next status and body. */
function fakeUpload(...answers: [number, unknown][]) {
  const sent: { url: string; headers: Record<string, string>; body: unknown }[] = [];
  class FakeXhr {
    upload: { onprogress?: (e: unknown) => void } = {};
    onload?: () => void; onerror?: () => void;
    status = 0; responseText = "";
    headers: Record<string, string> = {}; url = ""; withCredentials = false;
    open(_m: string, url: string) { this.url = url; }
    setRequestHeader(k: string, v: string) { this.headers[k] = v; }
    send(payload: unknown) {
      sent.push({ url: this.url, headers: this.headers, body: payload });
      const [status, body] = answers.shift() ?? [500, {}];
      this.status = status; this.responseText = JSON.stringify(body);
      queueMicrotask(() => { this.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 2 }); this.onload?.(); });
    }
  }
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
  return sent;
}
const picture = () => new File([new Uint8Array([1, 2, 3])], "IMG_1.jpg", { type: "image/jpeg" });

beforeEach(async () => { await useEnglish(); });
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllGlobals(); await resetLanguage(); });

describe("Visits today", () => {
  it("lists today's visits with their state and who is here, marked by whom", async () => {
    page([
      visit({ people: [here(alice), here(bruno, "Alice Roy")] }),
      notStarted({ event_id: 4, title: "Bureau", client_name: "Dion" }),
    ]);
    const first = await card("Ménage");
    expect(first.getByText(en.visStateInProgress)).toBeInTheDocument();
    expect(first.getByText("Alice Roy (self, 08:02)")).toBeInTheDocument();
    expect(first.getByText("Bruno (marked by Alice Roy, 08:02)")).toBeInTheDocument();
    expect(first.getByText(/Ducarme/)).toBeInTheDocument();
    const second = await card("Bureau");
    expect(second.getByText(en.visStateNotStarted)).toBeInTheDocument();
  });

  it("says so when there is no visit today", async () => {
    page([]);
    expect(await screen.findByText(en.visNone)).toBeInTheDocument();
  });

  it("checks in with the colleagues picked, the person pre-selected, then reloads the list", async () => {
    const api = page([notStarted()], { [`POST ${base}/checkin`]: { visit: visit() } });
    fireEvent.click((await card()).getByRole("button", { name: en.visCheckIn }));
    const dialog = within(await screen.findByRole("dialog", { name: en.visCheckIn }));
    expect(dialog.getByRole("checkbox", { name: /Alice Roy/ })).toBeChecked();
    expect(dialog.getByRole("checkbox", { name: "Bruno" })).not.toBeChecked();
    fireEvent.click(dialog.getByRole("checkbox", { name: "Bruno" }));
    fireEvent.click(dialog.getByRole("button", { name: en.visCheckIn }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.calls.find((c) => c.method === "POST")?.body).toEqual({ people: [1, 2] });
    expect(api.calls.filter((c) => c.path === "/api/visits/today").length).toBeGreaterThan(1);
  });

  it("offers only the listed people not checked in yet", async () => {
    page([visit({ people: [here(alice), here(bruno, "Alice Roy")] })]);
    fireEvent.click((await card()).getByRole("button", { name: en.visCheckIn }));
    const dialog = within(await screen.findByRole("dialog", { name: en.visCheckIn }));
    expect(dialog.getAllByRole("checkbox")).toHaveLength(1);
    expect(dialog.getByRole("checkbox", { name: "Carla" })).not.toBeChecked();
  });

  it("warns when there are no photos and closes without them only when asked", async () => {
    let n = 0;
    const api = page([visit()], { [`POST ${base}/checkout`]: () => (++n === 1 ? reply(409, { error: "no_photos" }) : { visit: closed() }) });
    fireEvent.click((await card()).getByRole("button", { name: en.visCheckOut }));
    const dialog = within(await screen.findByRole("dialog", { name: en.visNoPhotosTitle }));
    expect(dialog.getByText(en.visNoPhotosBody)).toBeInTheDocument();
    expect(en.visNoPhotosBody).toMatch(/highly recommended/);
    fireEvent.click(dialog.getByRole("button", { name: en.visCloseWithoutPhotos }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.calls.filter((c) => c.method === "POST").map((c) => c.body)).toEqual([{ confirm_no_photos: false }, { confirm_no_photos: true }]);
  });

  it("goes back to the photos on Take photos, without closing the visit", async () => {
    const api = page([visit()], { [`POST ${base}/checkout`]: reply(409, { error: "no_photos" }) });
    fireEvent.click((await card()).getByRole("button", { name: en.visCheckOut }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: en.visNoPhotosTitle })).getByRole("button", { name: en.visTakePhotos }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });

  it("lists the rooms that still need a photo or a skip", async () => {
    page([visit({ photos_required: true })], { [`POST ${base}/checkout`]: reply(409, { error: "rooms_missing", rooms: ["Kitchen", "Bathroom"] }) });
    fireEvent.click((await card()).getByRole("button", { name: en.visCheckOut }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(en.visRoomsMissing);
    expect(within(alert).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Kitchen", "Bathroom"]);
  });

  it("shows a clear message for a refusal", async () => {
    page([notStarted()], { [`POST ${base}/checkin`]: reply(422, { error: "not_today" }) });
    fireEvent.click((await card()).getByRole("button", { name: en.visCheckIn }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: en.visCheckIn })).getByRole("button", { name: en.visCheckIn }));
    expect(await screen.findByText(en.visErrNotToday)).toBeInTheDocument();
  });
});

describe("photos", () => {
  it("groups the photos by room, with the room's name as their text", async () => {
    page([visit({ photos: [{ id: 5, room_id: 1, room_name: "Kitchen", uploaded_by_name: "Alice Roy", uploaded_at: "2026-11-28T13:30:00+00:00", url: "/api/visit-photos/5" }] })]);
    const kitchen = within((await card()).getByRole("group", { name: "Kitchen" }));
    expect(kitchen.getByRole("img")).toHaveAttribute("src", "/api/visit-photos/5");
    expect(kitchen.getByRole("img")).toHaveAccessibleName(/Kitchen/);
    expect(within((await card()).getByRole("group", { name: "Bathroom" })).queryByRole("img")).toBeNull();
  });

  it("uploads a photo of a room as the raw body", async () => {
    page([visit()]);
    const sent = fakeUpload([201, { visit: visit() }]);
    const kitchen = within((await card()).getByRole("group", { name: "Kitchen" }));
    const camera = kitchen.getByLabelText(en.visAddPhoto);
    expect(camera).toHaveAttribute("capture", "environment");
    expect(camera).toHaveAttribute("accept", "image/*");
    fireEvent.change(camera, { target: { files: [picture()] } });
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].url).toBe(`${base}/photos?room_id=1`);
    expect(sent[0].headers["Content-Type"]).toBe("image/webp");
    expect(sent[0].headers["X-CSRF-Token"]).toBe("tok-1");
    expect(sent[0].body).toBeInstanceOf(Blob);
  });

  it("asks for a reason when the server says the change is a correction, then retries with it", async () => {
    page([visit()]);
    const sent = fakeUpload([409, { error: "correction_required" }], [201, { visit: visit() }]);
    fireEvent.change(within((await card()).getByRole("group", { name: "Kitchen" })).getByLabelText(en.visAddPhoto), { target: { files: [picture()] } });
    const dialog = within(await screen.findByRole("dialog"));
    fireEvent.change(dialog.getByLabelText(en.visCorrectionReason), { target: { value: "forgot the kitchen" } });
    fireEvent.click(dialog.getByRole("button", { name: en.visCorrect }));
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(new URL(sent[1].url, "http://x").searchParams.get("reason")).toBe("forgot the kitchen");
    expect(new URL(sent[1].url, "http://x").searchParams.get("room_id")).toBe("1");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("says when the photo storage is full", async () => {
    page([visit()]);
    fakeUpload([503, { error: "storage_full" }]);
    fireEvent.change(within((await card()).getByRole("group", { name: "Kitchen" })).getByLabelText(en.visAddPhoto), { target: { files: [picture()] } });
    expect(await screen.findByText(en.visErrStorageFull)).toBeInTheDocument();
  });

  it("names a room typed under Other", async () => {
    page([visit()]);
    const sent = fakeUpload([201, { visit: visit() }]);
    const other = within((await card()).getByRole("group", { name: en.visOtherRoom }));
    expect(other.getByLabelText(en.visAddPhoto)).toBeDisabled();
    fireEvent.change(other.getByLabelText(en.visOtherName), { target: { value: "Balcony" } });
    fireEvent.change(other.getByLabelText(en.visAddPhoto), { target: { files: [picture()] } });
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].url).toBe(`${base}/photos?other_name=Balcony`);
  });

  it("removes a photo of a closed visit with a reason in the body", async () => {
    const api = page(
      [closed({ photos: [{ id: 5, room_id: 1, room_name: "Kitchen", uploaded_by_name: "Alice Roy", uploaded_at: "2026-11-28T13:30:00+00:00", url: "/api/visit-photos/5" }] })],
      { "DELETE /api/visit-photos/5": { visit: closed() } },
    );
    fireEvent.click(within((await card()).getByRole("group", { name: "Kitchen" })).getByRole("button", { name: en.visRemovePhoto }));
    const dialog = within(await screen.findByRole("dialog"));
    fireEvent.change(dialog.getByLabelText(en.visCorrectionReason), { target: { value: "wrong house" } });
    fireEvent.click(dialog.getByRole("button", { name: en.visCorrect }));
    await waitFor(() => expect(api.calls.find((c) => c.method === "DELETE")?.body).toEqual({ reason: "wrong house" }));
  });

  it("skips a required room with a reason", async () => {
    const api = page([visit({ photos_required: true })], { [`POST ${base}/skips`]: { visit: visit() } });
    fireEvent.click(within((await card()).getByRole("group", { name: "Bathroom" })).getByRole("button", { name: en.visSkipRoom }));
    const dialog = within(await screen.findByRole("dialog", { name: en.visSkipRoom }));
    expect(dialog.queryByLabelText(en.visCorrectionReason)).toBeNull();
    fireEvent.change(dialog.getByLabelText(en.visSkipReason), { target: { value: "Locked" } });
    fireEvent.click(dialog.getByRole("button", { name: en.visSkipRoom }));
    await waitFor(() => expect(api.calls.find((c) => c.method === "POST")?.body).toEqual({ room_id: 2, reason: "Locked" }));
  });

  it("skips a room of a closed visit with the correction's reason in its own field", async () => {
    const api = page([closed({ photos_required: true })], { [`POST ${base}/skips`]: { visit: closed() } });
    fireEvent.click(within((await card()).getByRole("group", { name: "Bathroom" })).getByRole("button", { name: en.visSkipRoom }));
    const dialog = within(await screen.findByRole("dialog", { name: en.visSkipRoom }));
    fireEvent.change(dialog.getByLabelText(en.visSkipReason), { target: { value: "Locked" } });
    fireEvent.change(dialog.getByLabelText(en.visCorrectionReason), { target: { value: "forgot to note it" } });
    fireEvent.click(dialog.getByRole("button", { name: en.visSkipRoom }));
    await waitFor(() => expect(api.calls.find((c) => c.method === "POST")?.body).toEqual({ room_id: 2, reason: "Locked", correction_reason: "forgot to note it" }));
  });
});

describe("corrections", () => {
  it("hides Correct for Staff once the window is over", async () => {
    page([closed({ can_correct_until: anHourAgo() })]);
    const c = await card();
    expect(c.getByText(en.visStateClosed)).toBeInTheDocument();
    expect(c.queryByRole("button", { name: en.visCorrect })).toBeNull();
    expect(c.queryByLabelText(en.visAddPhoto)).toBeNull();
  });

  it("hides Correct on a visit not started on its own day, even with a window", async () => {
    page([notStarted({ can_correct_until: inOneHour() })]);
    expect((await card()).queryByRole("button", { name: en.visCorrect })).toBeNull();
  });

  it("hides Correct on a visit in progress on its own day", async () => {
    page([visit({ can_correct_until: inOneHour() })]);
    expect((await card()).queryByRole("button", { name: en.visCorrect })).toBeNull();
  });

  it("lets Staff add a late check-in within the window, with a required reason", async () => {
    const api = page([closed({ can_correct_until: inOneHour() })], { [`POST ${base}/corrections`]: reply(201, { visit: closed({ corrected: true }) }) });
    fireEvent.click((await card()).getByRole("button", { name: en.visCorrect }));
    const dialog = within(await screen.findByRole("dialog", { name: en.visCorrect }));
    expect(dialog.queryByRole("radio", { name: en.visCorrectionReopen })).toBeNull(); // admins only
    fireEvent.click(dialog.getByRole("radio", { name: en.visCorrectionAddPerson }));
    fireEvent.change(dialog.getByLabelText(en.visPerson), { target: { value: "2" } });
    const submit = dialog.getByRole("button", { name: en.visCorrect });
    expect(submit).toBeDisabled(); // the reason is required
    fireEvent.change(dialog.getByLabelText(en.visCorrectionReason), { target: { value: "Bruno came at 10" } });
    fireEvent.click(submit);
    await waitFor(() => expect(api.calls.find((c) => c.method === "POST")?.body).toEqual({ kind: "add_person", reason: "Bruno came at 10", user_id: 2 }));
  });

  it("closes a visit left open after its day", async () => {
    const api = mockApi({
      "GET /api/visits/today": { visits: [] },
      [`GET /api/visits/3/${yesterday}`]: { visit: visit({ occurrence_date: yesterday, date: yesterday }) },
      [`POST /api/visits/3/${yesterday}/corrections`]: reply(201, { visit: closed({ occurrence_date: yesterday, date: yesterday }) }),
    });
    renderWithProviders(<VisitsTodayPage />, { route: `/visits?event=3&date=${yesterday}` });
    const c = await card();
    expect(c.queryByRole("button", { name: en.visCheckOut })).toBeNull(); // after its day, a check-out is a correction
    fireEvent.click(c.getByRole("button", { name: en.visCorrect }));
    const dialog = within(await screen.findByRole("dialog", { name: en.visCorrect }));
    fireEvent.click(dialog.getByRole("radio", { name: en.visCorrectionClose }));
    fireEvent.change(dialog.getByLabelText(en.visCorrectionReason), { target: { value: "forgot to check out" } });
    fireEvent.click(dialog.getByRole("button", { name: en.visCorrect }));
    await waitFor(() => expect(api.calls.find((c) => c.method === "POST")?.body).toEqual({ kind: "close", reason: "forgot to check out" }));
  });

  it("lets an admin reopen a closed visit at any time", async () => {
    const api = page([closed({ can_correct_until: null })], { [`POST ${base}/corrections`]: reply(201, { visit: visit() }) }, admin);
    fireEvent.click((await card()).getByRole("button", { name: en.visCorrect }));
    const dialog = within(await screen.findByRole("dialog", { name: en.visCorrect }));
    fireEvent.click(dialog.getByRole("radio", { name: en.visCorrectionReopen }));
    fireEvent.change(dialog.getByLabelText(en.visCorrectionReason), { target: { value: "closed by mistake" } });
    fireEvent.click(dialog.getByRole("button", { name: en.visCorrect }));
    await waitFor(() => expect(api.calls.find((c) => c.method === "POST")?.body).toEqual({ kind: "reopen", reason: "closed by mistake" }));
  });

  it("shows the corrections next to the original", async () => {
    page([closed({ corrected: true, corrections: [{ kind: "close", actor_name: "Alice Roy", reason: "forgot to check out", created_at: "2026-11-28T16:30:00+00:00", details: {} }] })]);
    const c = await card();
    expect(c.getByText(en.visCorrected)).toBeInTheDocument();
    expect(c.getByText(/corrected by Alice Roy on .*, reason: forgot to check out/)).toBeInTheDocument();
  });
});
