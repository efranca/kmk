/**
 * Content blocks shown on the welcome page below the introduction. Empty for now.
 * To add content: add the title and body strings to all three files in `locales/`, then add an entry here, e.g.
 *   { titleKey: "welcomeHoursTitle", bodyKey: "welcomeHoursBody" }
 */
export type WelcomeBlock = { titleKey: string; bodyKey: string };

export const welcomeBlocks: WelcomeBlock[] = [];
