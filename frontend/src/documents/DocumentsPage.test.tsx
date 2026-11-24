import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "../i18n";
import en from "../locales/en.json";
import { renderWithProviders, testUser } from "../testUtils";
import { DocumentsPage } from "./DocumentsPage";

const res = (status: number, body: unknown = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const doc = (id: number, over: Record<string, unknown> = {}) => ({
  id, title: `Doc ${id}`, note: null, category_id: null, visibility: "everyone", file_name: `f${id}.pdf`, content_type: "application/pdf",
  size_bytes: 2048, has_file: true, created_by: { id: 1, name: "Alice" }, created_at: "2026-11-20T10:00:00Z", updated_at: "2026-11-20T10:00:00Z", ...over,
});
const data = {
  documents: [
    doc(1, { title: "Cleaning insurance policy", category_id: 10, note: "Renews in March", file_name: "polícia-2026.pdf" }),
    doc(2, { title: "Employee handbook", category_id: 11, visibility: "admins", content_type: "image/png" }),
    doc(3, { title: "Zebra", category_id: null }),
  ],
  categories: [{ id: 10, name: "Insurance", icon: "🛡️" }, { id: 11, name: "HR", icon: "👥" }],
};

let fetchMock: ReturnType<typeof vi.fn>;
const calls = (route: string) => fetchMock.mock.calls.filter(([url, init]) => `${(init as RequestInit | undefined)?.method ?? "GET"} ${url}` === route);

function mockApi(overrides: Record<string, () => unknown> = {}) {
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const route = `${init?.method ?? "GET"} ${url}`;
    if (overrides[route]) return overrides[route]();
    if (route === "GET /api/documents") return res(200, data);
    if (route === "POST /api/documents") return res(201, { document: doc(99, { has_file: false, size_bytes: null }) });
    if (route.startsWith("DELETE /api/documents/")) return res(204);
    if (route.startsWith("PATCH /api/documents/")) return res(200, { document: doc(1) });
    throw new Error(`unexpected ${route}`);
  });
  vi.stubGlobal("fetch", fetchMock);
}

/** A stand-in for XMLHttpRequest: the upload answers with the status the test chose. */
function fakeUpload(status: number, body: unknown = {}) {
  const sent: { url: string; headers: Record<string, string>; body: unknown }[] = [];
  class FakeXhr {
    upload: { onprogress?: (e: unknown) => void } = {};
    onload?: () => void; onerror?: () => void;
    status = 0; responseText = "";
    headers: Record<string, string> = {}; url = "";
    open(_m: string, url: string) { this.url = url; }
    setRequestHeader(k: string, v: string) { this.headers[k] = v; }
    send(payload: unknown) {
      sent.push({ url: this.url, headers: this.headers, body: payload });
      this.status = status; this.responseText = JSON.stringify(body);
      queueMicrotask(() => { this.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 2 }); this.onload?.(); });
    }
  }
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
  return sent;
}

const admin = { session: { user: { ...testUser, role: "admin" as const } } };

beforeEach(async () => {
  await act(() => i18n.changeLanguage("en"));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Documents page", () => {
  it("lists documents with their category, level and size", async () => {
    mockApi();
    renderWithProviders(<DocumentsPage />);
    expect(await screen.findByText("Cleaning insurance policy")).toBeInTheDocument();
    expect(screen.getByText(en.docLevelAdmins)).toBeInTheDocument();
    expect(screen.getAllByText(/2 KB/).length).toBeGreaterThan(0);
  });

  it("filters by category with counts", async () => {
    mockApi();
    renderWithProviders(<DocumentsPage />);
    await screen.findByText("Zebra");
    fireEvent.click(screen.getByRole("button", { name: /HR 1/ }));
    expect(screen.queryByText("Zebra")).toBeNull();
    expect(screen.getByText("Employee handbook")).toBeInTheDocument();
  });

  it("searches title, note, category and file name ignoring accents and case", async () => {
    mockApi();
    renderWithProviders(<DocumentsPage />);
    await screen.findByText("Zebra");
    fireEvent.click(screen.getByRole("button", { name: en.docSearchLabel }));
    const box = screen.getByRole("searchbox");
    for (const [query, shown] of [["MARCH", "Cleaning insurance policy"], ["policia", "Cleaning insurance policy"], ["hr", "Employee handbook"], ["zeb", "Zebra"]]) {
      fireEvent.change(box, { target: { value: query } });
      expect(screen.getByText(shown)).toBeInTheDocument();
      expect(screen.getAllByRole("listitem")).toHaveLength(1);
    }
    fireEvent.change(box, { target: { value: "nothing like this" } });
    expect(screen.getByText(/nothing like this/)).toBeInTheDocument();
  });

  it("gives a plain user no way to add, edit or delete", async () => {
    mockApi();
    renderWithProviders(<DocumentsPage />);
    await screen.findByText("Zebra");
    expect(screen.queryByRole("button", { name: en.docNew })).toBeNull();
    fireEvent.click(screen.getByText("Zebra"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("link", { name: en.docOpen })).toHaveAttribute("href", "/api/documents/3/file");
    expect(within(dialog).getByRole("link", { name: en.docDownload })).toHaveAttribute("href", "/api/documents/3/file?download=1");
    expect(within(dialog).queryByRole("button", { name: en.save })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: en.delete })).toBeNull();
  });

  it("lets an administrator add a document: details first, then the file, with the file name", async () => {
    mockApi();
    const sent = fakeUpload(204);
    renderWithProviders(<DocumentsPage />, admin);
    await screen.findByText("Zebra");
    fireEvent.click(screen.getByRole("button", { name: en.docNew }));
    const dialog = await screen.findByRole("dialog");
    const file = new File(["%PDF-1.4"], "Lease 2026.pdf", { type: "application/pdf" });
    fireEvent.change(within(dialog).getByLabelText(en.docFieldFile), { target: { files: [file] } });
    await waitFor(() => expect(within(dialog).getByLabelText(en.docFieldTitle)).toHaveValue("Lease 2026")); // suggested from the file name
    fireEvent.click(within(dialog).getByRole("button", { name: en.save }));
    await waitFor(() => expect(sent).toHaveLength(1));
    const post = JSON.parse(String((calls("POST /api/documents")[0][1] as RequestInit).body));
    expect(post).toEqual({ title: "Lease 2026", note: null, category_id: null, visibility: "admins" }); // fails closed
    expect(sent[0].url).toBe("/api/documents/99/file");
    expect(decodeURIComponent(sent[0].headers["X-File-Name"])).toBe("Lease 2026.pdf");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("cleans up the half-made document and says why when the file is refused", async () => {
    mockApi();
    fakeUpload(422, { error: "file_too_large" });
    renderWithProviders(<DocumentsPage />, admin);
    await screen.findByText("Zebra");
    fireEvent.click(screen.getByRole("button", { name: en.docNew }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(en.docFieldFile), { target: { files: [new File(["%PDF-"], "a.pdf", { type: "application/pdf" })] } });
    await waitFor(() => expect(within(dialog).getByLabelText(en.docFieldTitle)).toHaveValue("a"));
    fireEvent.click(within(dialog).getByRole("button", { name: en.save }));
    expect(await within(dialog).findByText(en.err_file_too_large)).toBeInTheDocument();
    await waitFor(() => expect(calls("DELETE /api/documents/99")).toHaveLength(1));
  });

  it("refuses a file of the wrong type before sending anything", async () => {
    mockApi();
    renderWithProviders(<DocumentsPage />, admin);
    await screen.findByText("Zebra");
    fireEvent.click(screen.getByRole("button", { name: en.docNew }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(en.docFieldFile), { target: { files: [new File(["x"], "a.zip", { type: "application/zip" })] } });
    expect(await within(dialog).findByText(en.err_invalid_file)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: en.save })).toBeDisabled();
    expect(calls("POST /api/documents")).toHaveLength(0);
  });

  it("offers only the levels up to the person's own", async () => {
    mockApi();
    renderWithProviders(<DocumentsPage />, admin);
    await screen.findByText("Zebra");
    fireEvent.click(screen.getByRole("button", { name: en.docNew }));
    const select = within(await screen.findByRole("dialog")).getByLabelText(en.docFieldVisibility);
    expect([...select.querySelectorAll("option")].map((o) => o.textContent)).toEqual([en.docLevelEveryone, en.docLevelAdmins]);
  });

  it("asks before deleting and then deletes", async () => {
    mockApi();
    renderWithProviders(<DocumentsPage />, admin);
    fireEvent.click(await screen.findByText("Zebra"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: en.delete }));
    expect(calls("DELETE /api/documents/3")).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole("button", { name: en.docDeleteConfirm }));
    await waitFor(() => expect(calls("DELETE /api/documents/3")).toHaveLength(1));
  });

  it("says when the library is empty", async () => {
    mockApi({ "GET /api/documents": () => res(200, { documents: [], categories: [] }) });
    renderWithProviders(<DocumentsPage />, admin);
    expect(await screen.findByText(en.docEmpty)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: en.docAddFirst })).toBeInTheDocument();
  });

  it("shows an error with a retry when the list cannot be loaded", async () => {
    mockApi({ "GET /api/documents": () => res(500, { error: "x" }) });
    renderWithProviders(<DocumentsPage />);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});
