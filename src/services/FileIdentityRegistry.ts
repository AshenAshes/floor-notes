import type { TFile } from "obsidian";

export interface FileIdentityInfo {
  readonly token: string;
  readonly path: string;
  readonly epoch: number;
  readonly state: "active" | "tombstoned";
}

export class FileIdentityRegistry {
  private counter = 0;
  private readonly fileIdentities = new WeakMap<object, string>();
  private readonly identityInfo = new Map<string, { path: string; epoch: number; state: "active" | "tombstoned" }>();
  private readonly pathIdentities = new Map<string, string>();

  public getOrCreateIdentity(file: TFile): string {
    let token = this.fileIdentities.get(file);
    if (!token) {
      this.counter++;
      token = `fid-${this.counter}`;
      this.fileIdentities.set(file, token);
      this.identityInfo.set(token, {
        path: file.path,
        epoch: 0,
        state: "active"
      });
      this.pathIdentities.set(file.path, token);
    }
    return token;
  }

  public getIdentityInfo(token: string): { readonly path: string; readonly epoch: number; readonly state: "active" | "tombstoned" } | undefined {
    return this.identityInfo.get(token);
  }

  public getIdentityByPath(path: string): string | undefined {
    return this.pathIdentities.get(path);
  }

  public handleRename(file: TFile, oldPath: string): void {
    const token = this.fileIdentities.get(file);
    if (token) {
      const info = this.identityInfo.get(token);
      if (info) {
        this.identityInfo.set(token, {
          path: file.path,
          epoch: info.epoch + 1,
          state: info.state
        });
        this.pathIdentities.delete(oldPath);
        this.pathIdentities.set(file.path, token);
      }
    }
  }

  public handleDelete(file: TFile): void {
    const token = this.fileIdentities.get(file);
    if (token) {
      const info = this.identityInfo.get(token);
      if (info) {
        this.identityInfo.set(token, {
          path: info.path,
          epoch: info.epoch + 1,
          state: "tombstoned"
        });
        this.pathIdentities.delete(info.path);
      }
    }
  }
}
