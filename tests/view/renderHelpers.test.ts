import { describe, expect, it, vi } from "vitest";
import { Component } from "obsidian";
import type { ParsedRecord } from "../../src/format/types";
import { renderHeader, renderRecord } from "../../src/view/components/renderHelpers";

const record: ParsedRecord = {
  type: "floor",
  id: "floor-20260716-153012-abcde123",
  date: "2026-07-16 15:30:12",
  favorite: false,
  floorNumber: 1
} as ParsedRecord;

describe("renderHeader", () => {
  it("adds an accessible control for changing the thread view style", () => {
    const container = document.createElement("div");
    const onSelectViewStyle = vi.fn();

    renderHeader(
      container,
      { title: "Thread title" } as never,
      () => {},
      () => {},
      () => {},
      onSelectViewStyle
    );

    const button = container.querySelector<HTMLButtonElement>("button[aria-label='Change thread view style']");
    expect(button).not.toBeNull();
    button?.click();
    expect(onSelectViewStyle).toHaveBeenCalledWith(button);
  });
});

describe("renderRecord semantic structure", () => {
  it("renders a record article with semantic metadata and stable action classes", async () => {
    const container = document.createElement("div");
    const scope = new Component();
    scope.load();

    await renderRecord(
      container,
      record,
      "Record body.",
      { workspace: { openLinkText: vi.fn() } } as never,
      "thread.md",
      scope,
      () => {},
      () => {},
      () => {},
      () => {}
    );

    const article = container.querySelector<HTMLElement>("article.floor-notes-record.floor-notes-floor");
    expect(article?.dataset.recordKind).toBe("floor");
    expect(article?.dataset.floorLabel).toBe("01");
    expect(article?.querySelector(".floor-notes-record-content .floor-notes-body")).not.toBeNull();
    expect(article?.querySelector<HTMLElement>("footer.floor-notes-record-footer time.floor-notes-date")?.innerText).toBe(record.date);
    expect(article?.querySelector(".floor-notes-record-action-favorite")).not.toBeNull();
    expect(article?.querySelector(".floor-notes-record-action-reply")).not.toBeNull();
    expect(article?.querySelector(".floor-notes-record-action-edit")).not.toBeNull();
    expect(article?.querySelector(".floor-notes-record-action-delete")).not.toBeNull();
  });
});

describe("renderRecord internal-link routing", () => {
  it("routes a rendered alias link with its original source path", async () => {
    const openLinkText = vi.fn().mockResolvedValue(undefined);
    const app = { workspace: { openLinkText } };
    const container = document.createElement("div");
    const scope = new Component();
    scope.load();

    await renderRecord(
      container,
      record,
      "[[folder/target#heading|Readable label]]",
      app as never,
      "folder/source.md",
      scope,
      () => {},
      () => {},
      () => {}
    );

    const link = container.querySelector<HTMLAnchorElement>("a.internal-link[data-href]");
    expect(link?.dataset.href).toBe("folder/target#heading");
    link?.createSpan({ text: "Nested target" }).click();

    expect(openLinkText).toHaveBeenCalledWith("folder/target#heading", "folder/source.md");
  });

  it("does not intercept external links and removes routing when the scope unloads", async () => {
    const openLinkText = vi.fn().mockResolvedValue(undefined);
    const app = { workspace: { openLinkText } };
    const container = document.createElement("div");
    const scope = new Component();
    scope.load();

    await renderRecord(
      container,
      record,
      "[[relative-note^block-id]]",
      app as never,
      "folder/source.md",
      scope,
      () => {},
      () => {},
      () => {}
    );

    const body = container.querySelector<HTMLElement>(".floor-notes-body");
    const internalLink = body?.querySelector<HTMLAnchorElement>("a.internal-link[data-href]");
    const externalLink = body?.createEl("a", {
      text: "External",
      attr: { href: "https://example.com" }
    });
    externalLink?.addEventListener("click", (event) => event.preventDefault());
    externalLink?.click();

    expect(openLinkText).not.toHaveBeenCalled();

    internalLink?.click();
    expect(openLinkText).toHaveBeenCalledWith("relative-note^block-id", "folder/source.md");

    scope.unload();
    internalLink?.click();
    expect(openLinkText).toHaveBeenCalledTimes(1);
  });
});
