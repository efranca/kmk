import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";

// The pre-login language is kept in localStorage: never let one test leak it into the next.
afterEach(() => {
  try {
    window.localStorage.clear();
  } catch {
    // not available in this environment
  }
});
