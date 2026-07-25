import type { App, TFile } from "obsidian";
import { FileIdentityRegistry } from "./FileIdentityRegistry";
import { SerialTaskQueue } from "./SerialTaskQueue";
import { parseThreadDocument } from "../format/parser";
import { ParsedThreadDocument } from "../format/types";
import { PreferredNewline, ThreadViewStyle } from "../settings/types";
import {
  OperationResult,
  addFloor,
  addReply,
  editFloor,
  editReply,
  deleteFloor,
  deleteReply,
  setFavorite,
  setSortOrder,
  setViewStyle
} from "../format/operations";

export class ThreadMutationService {
  private readonly queues = new Map<string, SerialTaskQueue>();
  private readonly listeners = new Set<(token: string, newDoc: ParsedThreadDocument) => void>();

  constructor(
    private readonly app: App,
    private readonly registry: FileIdentityRegistry,
    private readonly getPreferredNewline: () => PreferredNewline = () => "auto"
  ) {}

  public addAppliedListener(listener: (token: string, newDoc: ParsedThreadDocument) => void): void {
    this.listeners.add(listener);
  }

  public removeAppliedListener(listener: (token: string, newDoc: ParsedThreadDocument) => void): void {
    this.listeners.delete(listener);
  }

  private async executeMutation(
    file: TFile,
    runOp: (doc: ParsedThreadDocument) => OperationResult
  ): Promise<OperationResult> {
    const token = this.registry.getOrCreateIdentity(file);
    const info = this.registry.getIdentityInfo(token);
    
    if (!info || info.state === "tombstoned") {
      return { type: "missing", message: "File has been deleted." };
    }

    let queue = this.queues.get(token);
    if (!queue) {
      queue = new SerialTaskQueue((idleQueue) => {
        if (this.queues.get(token) === idleQueue) {
          this.queues.delete(token);
        }
      });
      this.queues.set(token, queue);
    }

    return queue.add(async () => {
      // Re-verify status before entering Vault.process
      const currentInfo = this.registry.getIdentityInfo(token);
      if (!currentInfo || currentInfo.state === "tombstoned") {
        return { type: "missing", message: "File has been deleted." };
      }

      let opResult: OperationResult | null = null;
      try {
        await this.app.vault.process(file, (data) => {
          // Re-verify inside callback to ensure deletion during queue wait is handled
          const callbackInfo = this.registry.getIdentityInfo(token);
          if (!callbackInfo || callbackInfo.state === "tombstoned") {
            opResult = { type: "missing", message: "File has been deleted." };
            return data;
          }

          const parseRes = parseThreadDocument(data, file.name);
          if (!parseRes.ok) {
            opResult = { type: "invalid", diagnostics: parseRes.diagnostics };
            return data;
          }

          const res = runOp(parseRes.doc);
          opResult = res;

          if (res.type === "applied") {
            return res.newText;
          }
          return data;
        });
      } catch (err) {
        return { type: "conflict", reason: `Vault write failed: ${String(err)}` };
      }

      const finalResult = opResult as OperationResult | null;
      if (finalResult && finalResult.type === "applied") {
        for (const listener of this.listeners) {
          try {
            listener(token, finalResult.newDoc);
          } catch (e) {
            console.error("Error in ThreadMutationService listener:", e);
          }
        }
      }

      return finalResult || { type: "conflict", reason: "Operation was not executed." };
    });
  }

  public async addFloor(file: TFile, body: string, date: Date): Promise<OperationResult> {
    return this.executeMutation(file, (doc) => addFloor(doc, body, date, this.getPreferredNewline()));
  }

  public async addReply(file: TFile, targetFloorId: string, body: string, date: Date): Promise<OperationResult> {
    return this.executeMutation(file, (doc) => addReply(doc, targetFloorId, body, date, this.getPreferredNewline()));
  }

  public async editFloor(file: TFile, targetId: string, expectedBody: string, newBody: string): Promise<OperationResult> {
    return this.executeMutation(file, (doc) => editFloor(doc, targetId, expectedBody, newBody, this.getPreferredNewline()));
  }

  public async editReply(file: TFile, targetId: string, expectedBody: string, newBody: string): Promise<OperationResult> {
    return this.executeMutation(file, (doc) => editReply(doc, targetId, expectedBody, newBody, this.getPreferredNewline()));
  }

  public async deleteFloor(
    file: TFile,
    targetId: string,
    expectedRevisions: readonly { readonly id: string; readonly revision: string }[]
  ): Promise<OperationResult> {
    return this.executeMutation(file, (doc) => deleteFloor(doc, targetId, expectedRevisions, this.getPreferredNewline()));
  }

  public async deleteReply(file: TFile, targetId: string, expectedRevision: string): Promise<OperationResult> {
    return this.executeMutation(file, (doc) => deleteReply(doc, targetId, expectedRevision, this.getPreferredNewline()));
  }

  public async setFavorite(file: TFile, floorId: string, desired: boolean): Promise<OperationResult> {
    return this.executeMutation(file, (doc) => setFavorite(doc, floorId, desired, this.getPreferredNewline()));
  }

  public async setSortOrder(file: TFile, desired: "asc" | "desc"): Promise<OperationResult> {
    return this.executeMutation(file, (doc) => setSortOrder(doc, desired, this.getPreferredNewline()));
  }

  public async setViewStyle(file: TFile, desired: ThreadViewStyle): Promise<OperationResult> {
    return this.executeMutation(file, (doc) => setViewStyle(doc, desired, this.getPreferredNewline()));
  }
}
