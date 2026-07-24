import { App, TFile } from "obsidian";

type PrivateSaveAttachment = (
  this: App,
  name: string,
  extension: string,
  data: ArrayBuffer
) => Promise<unknown>;

function createPastedImageStem(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return [
    "Pasted image ",
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join("");
}

function getPrivateSaveAttachment(app: App): PrivateSaveAttachment | null {
  const candidate: unknown = Reflect.get(app, "saveAttachment");
  return typeof candidate === "function" ? candidate as PrivateSaveAttachment : null;
}

function isUsableTFile(value: unknown): value is TFile {
  return value instanceof TFile && value.path !== "" && value.name !== "";
}

export async function savePastedImageAttachment(
  app: App,
  sourcePath: string,
  extension: string,
  data: ArrayBuffer
): Promise<TFile> {
  const stem = createPastedImageStem(new Date());
  const activeFile = app.workspace.getActiveFile();
  const saveAttachment = getPrivateSaveAttachment(app);

  if (activeFile instanceof TFile && activeFile.path === sourcePath && saveAttachment) {
    try {
      const privateFile = await saveAttachment.call(app, stem, extension, data);
      if (isUsableTFile(privateFile)) {
        return privateFile;
      }
    } catch {
      // Private attachment hooks are optional; fall through to the public API.
    }
  }

  const attachmentPath = await app.fileManager.getAvailablePathForAttachment(
    `${stem}.${extension}`,
    sourcePath
  );
  return app.vault.createBinary(attachmentPath, data);
}
