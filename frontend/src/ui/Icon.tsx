// Line icons (24px grid, 1.75px stroke, currentColor), the set FamillAI draws its screens with. Paths are static constants.
const PATHS = {
  home: '<path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z"/>',
  calendar: '<rect x="4" y="5" width="16" height="15" rx="3"/><path d="M4 10h16M8.5 3v4M15.5 3v4"/>',
  family: '<circle cx="9" cy="8" r="3.5"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M16.5 14.1c2.6.4 4.5 2.7 4.5 5.4"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.4-4.4"/>',
  trash: '<path d="M4 7h16M9.5 7V4.5h5V7M6 7l1 13h10l1-13"/>',
  bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15Z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  logout: '<path d="M14 4h4.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H14"/><path d="M10 16l-4-4 4-4M6 12h10"/>',
  pencil: '<path d="M4 20l1-4.5L16 4.5l3.5 3.5L8.5 19z"/><path d="m14 7 3.5 3.5"/>',
  repeat: '<path d="M4 11V9a3 3 0 0 1 3-3h11l-2.5-2.5M20 13v2a3 3 0 0 1-3 3H6l2.5 2.5"/>',
  "chev-left": '<path d="m14.5 6-6 6 6 6"/>',
  "chev-right": '<path d="m9.5 6 6 6-6 6"/>',
  "chev-down": '<path d="m6 9.5 6 6 6-6"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M17 5.5a3 3 0 0 1 0 5.5M21 20c0-2.6-1.6-4.7-4-5.6"/>',
  tasks: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8 9.5 1.5 1.5 3-3M8 16h8"/>',
  account: '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c0-4 3.4-6.5 7.5-6.5s7.5 2.5 7.5 6.5"/>',
} as const;

export type IconName = keyof typeof PATHS;

/** Inline line icon (no icon font, no extra requests). Decorative: the button or label carries the name. */
export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      dangerouslySetInnerHTML={{ __html: PATHS[name] }}
    />
  );
}
