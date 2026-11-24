import { useState } from "react";

const KEY = "kmk.sidebar.collapsed";

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/** Whether the desktop sidebar is collapsed to icons: a per-device convenience (storage may be unavailable). */
export function useSidebarCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(read);
  const toggle = () =>
    setCollapsed((was) => {
      const next = !was;
      try {
        localStorage.setItem(KEY, next ? "1" : "0");
      } catch {
        /* still collapses for this visit */
      }
      return next;
    });
  return [collapsed, toggle];
}
