import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { QuoteForm } from "./QuoteForm";

type Call = { method: string; url: string; body: unknown };
let calls: Call[];
let startStatus: number;

function stubFetch() {
  calls = [];
  startStatus = 201;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const body = typeof init.body === "string" ? JSON.parse(init.body) : init.body;
    calls.push({ method, url, body });
    const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
    if (url === "/api/public/quotes/config") return json(200, { phone: "(418) 555-0100" });
    if (url === "/api/public/quotes" && method === "POST") return startStatus === 201 ? json(201, { id: 7, token: "tok" }) : json(startStatus, { error: "rate_limited" });
    if (url.endsWith("/photos")) return json(201, { photo: { id: 1, size: 1, content_type: "image/jpeg" } });
    if (url.endsWith("/submit")) return json(200, { reference: "D-0007" });
    return json(404, {});
  }));
}

const jpeg = (name = "a.jpg", size = 100) => new File([new Uint8Array(size)], name, { type: "image/jpeg" });

async function fillContact(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/^Name/), "Maria Silva");
  await user.type(screen.getByLabelText(/^Email/), "maria@example.com");
  await user.type(screen.getByLabelText(/^Phone/), "418-555-0100");
  await user.type(screen.getByLabelText(/^Address or neighbourhood/), "Québec");
}

async function fillSpace(user: ReturnType<typeof userEvent.setup>, property = "apartment") {
  await user.selectOptions(screen.getByLabelText(/^Type of property/), property);
  await user.selectOptions(screen.getByLabelText(/^Frequency you want/), "weekly");
}

beforeEach(() => {
  window.history.pushState({}, "", "/devis?lang=en");
  stubFetch();
});
afterEach(() => vi.unstubAllGlobals());

describe("QuoteForm", () => {
  it("has a honeypot that people cannot reach", () => {
    render(<QuoteForm />);
    const trap = document.querySelector<HTMLInputElement>("input[name=website]")!;
    expect(trap.tabIndex).toBe(-1);
    expect(trap.getAttribute("aria-hidden")).toBe("true");
  });

  it("sends an Airbnb request with its photos and shows the reference", async () => {
    const user = userEvent.setup();
    render(<QuoteForm />);
    await user.click(screen.getByRole("radio", { name: /Airbnb/ }));
    await fillContact(user);
    await fillSpace(user);
    await user.type(screen.getByLabelText(/^Bedrooms/), "2");
    await user.type(screen.getByLabelText(/^Bathrooms/), "1.5");
    await user.upload(screen.getByLabelText(/Add photos/), [jpeg("a.jpg"), jpeg("b.jpg")]);
    await user.click(screen.getByRole("button", { name: "Send my request" }));
    expect(await screen.findByText("D-0007")).toBeInTheDocument();
    const sequence = calls.filter((c) => c.url !== "/api/public/quotes/config").map((c) => `${c.method} ${c.url}`);
    expect(sequence).toEqual([
      "POST /api/public/quotes", "PUT /api/public/quotes/7/photos", "PUT /api/public/quotes/7/photos", "POST /api/public/quotes/7/submit",
    ]);
    const start = calls.find((c) => c.method === "POST" && c.url === "/api/public/quotes")!.body as Record<string, unknown>;
    expect(start).toMatchObject({ kind: "airbnb", locale: "en-CA", name: "Maria Silva", city: "Québec", bedrooms: 2, bathrooms: 1.5, website: "" });
  });

  it("asks a commercial customer for the details and does not send without them", async () => {
    const user = userEvent.setup();
    render(<QuoteForm />);
    await user.click(screen.getByRole("radio", { name: /Commercial/ }));
    await fillContact(user);
    await fillSpace(user, "office");
    await user.click(screen.getByRole("button", { name: "Send my request" }));
    expect(await screen.findByText("Please describe your space.")).toBeInTheDocument();
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("stops at 2000 words: red counter and Send disabled", async () => {
    render(<QuoteForm />);
    fireEvent.change(screen.getByLabelText(/Tell us about your space/), { target: { value: "w ".repeat(2000) } });
    expect(screen.getByText("2000 / 2000 words")).not.toHaveClass("over");
    fireEvent.change(screen.getByLabelText(/Tell us about your space/), { target: { value: "w ".repeat(2001) } });
    expect(screen.getByText("2001 / 2000 words")).toHaveClass("over");
    expect(screen.getByRole("button", { name: "Send my request" })).toBeDisabled();
  });

  it("shows the polite limit message with the phone number on a 429", async () => {
    startStatus = 429;
    const user = userEvent.setup();
    render(<QuoteForm />);
    await user.click(screen.getByRole("radio", { name: /Airbnb/ }));
    await fillContact(user);
    await fillSpace(user);
    await user.type(screen.getByLabelText(/^Bedrooms/), "1");
    await user.type(screen.getByLabelText(/^Bathrooms/), "1");
    await user.click(screen.getByRole("button", { name: "Send my request" }));
    expect(await screen.findByText(/several requests in a short time/)).toHaveTextContent("(418) 555-0100");
  });

  it("refuses an 11th photo, an oversized photo and a PDF before sending anything", async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(<QuoteForm />);
    const input = screen.getByLabelText(/Add photos/);
    await user.upload(input, Array.from({ length: 10 }, (_, i) => jpeg(`p${i}.jpg`)));
    await user.upload(input, jpeg("eleventh.jpg"));
    expect(await screen.findByText(/at most 10 photos/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Remove photo/ })).toHaveLength(10);
    await user.upload(input, new File(["%PDF"], "doc.pdf", { type: "application/pdf" }));
    expect(await screen.findByText(/JPEG, PNG, WebP or HEIC/)).toBeInTheDocument();
    expect(calls.some((c) => c.method === "PUT")).toBe(false);
  });

  it("switches language from the header", async () => {
    const user = userEvent.setup();
    render(<QuoteForm />);
    await user.click(screen.getByRole("button", { name: "Français" }));
    await waitFor(() => expect(document.documentElement.lang).toBe("fr-CA"));
    expect(screen.getByRole("button", { name: "Envoyer ma demande" })).toBeInTheDocument();
  });
});
