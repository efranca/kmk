/** True when the app runs installed on the home screen (PWA). There is no browser bar and no back button there (an iPhone has none). */
export function isInstalledApp(): boolean {
  if (typeof window === "undefined") return false;
  const standalone = typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches;
  return standalone || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/**
 * Saves a file without leaving the app: the share sheet when the device has one ("Save to Files" on an iPhone), else a
 * download from a temporary address. A plain link to the file would take the whole installed app to the raw file.
 */
export async function saveFile(url: string, fileName: string): Promise<void> {
  const response = await fetch(url, { credentials: "same-origin" });
  if (!response.ok) throw new Error("download");
  const blob = await response.blob();
  const file = new File([blob], fileName, { type: blob.type });
  if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] }) && typeof navigator.share === "function") {
    try {
      await navigator.share({ files: [file], title: fileName });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) throw error; // closing the sheet is not a failure
    }
    return;
  }
  const address = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = address;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(address), 10_000);
}
