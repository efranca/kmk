import { execSync } from "node:child_process";

/**
 * The version shown in Settings > About: the first two numbers of package.json's version (chosen by hand, for a release
 * that means something) and the number of commits as the third, so every build from a newer commit has a higher version.
 * Without a usable count (no git, or a shallow clone where the count would be wrong) the package.json version is kept.
 */
export function appVersion(packageVersion: string, commits: number | null): string {
  if (commits === null) return packageVersion;
  const [major, minor] = packageVersion.split(".");
  return `${major}.${minor ?? "0"}.${commits}`;
}

function git(args: string): string | null {
  try {
    return execSync(`git ${args}`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return null;
  }
}

/** The commit count of HEAD, or null when git is missing or the history is cut short. */
export function commitCount(): number | null {
  if (git("rev-parse --is-shallow-repository") !== "false") return null;
  const n = Number(git("rev-list --count HEAD"));
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** The short commit this build was made from, or "" when git is not there. */
export function shortCommit(): string {
  return git("rev-parse --short HEAD") ?? "";
}
