import { describe, expect, it, vi } from "vitest";
import { Component, MarkdownRenderer } from "obsidian";
import type { ParsedRecord } from "../../src/format/types";
import {
  createA11yButton,
  createA11yIconButton,
  renderHeader,
  renderRecord
} from "../../src/view/components/renderHelpers";
import { appendRenderedImageFixture } from "../helpers/renderedImage";

const record: ParsedRecord = {
  type: "floor",
  id: "floor-20260716-153012-abcde123",
  date: "2026-07-16 15:30:12",
  favorite: false,
  floorNumber: 1
} as ParsedRecord;

describe("accessible button factories", () => {
  it("uses native button activation without invoking callbacks from keydown", () => {
    const container = document.createElement("div");
    const onTextButtonClick = vi.fn();
    const onIconButtonClick = vi.fn();
    const textButton = createA11yButton(container, "Action", "Action", onTextButtonClick);
    const iconButton = createA11yIconButton(container, "plus", "Add", onIconButtonClick);

    expect(textButton.type).toBe("button");
    expect(iconButton.type).toBe("button");

    for (const button of [textButton, iconButton]) {
      button.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      button.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    }

    expect(onTextButtonClick).not.toHaveBeenCalled();
    expect(onIconButtonClick).not.toHaveBeenCalled();

    textButton.click();
    iconButton.click();

    expect(onTextButtonClick).toHaveBeenCalledOnce();
    expect(onTextButtonClick).toHaveBeenCalledWith(textButton);
    expect(onIconButtonClick).toHaveBeenCalledOnce();
    expect(onIconButtonClick).toHaveBeenCalledWith(iconButton);
  });
});

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

describe("renderRecord image labels", () => {
  it("hides an automatic attachment filename without removing the image alt text", async () => {
    vi.spyOn(MarkdownRenderer, "render").mockImplementationOnce(async (_app, _markdown, container) => {
      appendRenderedImageFixture(container, {
        source: "attachments/file-20260810204041249.png",
        label: "file-20260810204041249.png"
      });
    });
    const container = document.createElement("div");
    const scope = new Component();
    scope.load();

    await renderRecord(
      container,
      record,
      "![[attachments/file-20260810204041249.png]]",
      { workspace: { openLinkText: vi.fn() } } as never,
      "thread.md",
      scope,
      () => {},
      () => {},
      () => {}
    );

    const embed = container.querySelector<HTMLElement>(".floor-notes-body .image-embed");
    const image = embed?.querySelector<HTMLImageElement>("img");
    expect(embed?.hasAttribute("alt")).toBe(false);
    expect(image?.alt).toBe("file-20260810204041249.png");
    expect(embed?.querySelector(".floor-notes-image-description")).toBeNull();
    expect(embed?.parentElement?.classList.contains("floor-notes-image-paragraph")).toBe(true);
  });

  it("shows a meaningful image description supplied by the author", async () => {
    vi.spyOn(MarkdownRenderer, "render").mockImplementationOnce(async (_app, _markdown, container) => {
      appendRenderedImageFixture(container, {
        source: "attachments/file-20260810204041249.png",
        label: "副屏配件"
      });
    });
    const container = document.createElement("div");
    const scope = new Component();
    scope.load();

    await renderRecord(
      container,
      record,
      "![[attachments/file-20260810204041249.png|副屏配件]]",
      { workspace: { openLinkText: vi.fn() } } as never,
      "thread.md",
      scope,
      () => {},
      () => {},
      () => {}
    );

    const embed = container.querySelector<HTMLElement>(".floor-notes-body .image-embed");
    const image = embed?.querySelector<HTMLImageElement>("img");
    const description = embed?.querySelector<HTMLElement>(".floor-notes-image-description");
    expect(embed?.hasAttribute("alt")).toBe(false);
    expect(image?.alt).toBe("副屏配件");
    expect(description?.innerText).toBe("副屏配件");
    expect(description?.getAttribute("aria-hidden")).toBe("true");
    expect(embed?.parentElement?.classList.contains("floor-notes-image-paragraph")).toBe(true);
  });

  it("keeps a standard Markdown image accessible and gives its image-only paragraph block flow", async () => {
    vi.spyOn(MarkdownRenderer, "render").mockImplementationOnce(async (_app, _markdown, container) => {
      appendRenderedImageFixture(container, {
        source: "attachments/screen-photo.png",
        label: "屏幕照片",
        kind: "markdown"
      });
    });
    const container = document.createElement("div");
    const scope = new Component();
    scope.load();

    await renderRecord(
      container,
      record,
      "![屏幕照片](attachments/screen-photo.png)",
      { workspace: { openLinkText: vi.fn() } } as never,
      "thread.md",
      scope,
      () => {},
      () => {},
      () => {}
    );

    const image = container.querySelector<HTMLImageElement>(".floor-notes-body img");
    expect(image?.alt).toBe("屏幕照片");
    expect(container.querySelector(".floor-notes-image-description")).toBeNull();
    expect(image?.parentElement?.classList.contains("floor-notes-image-paragraph")).toBe(true);
  });

  it("does not display an Obsidian image size as a description", async () => {
    vi.spyOn(MarkdownRenderer, "render").mockImplementationOnce(async (_app, _markdown, container) => {
      appendRenderedImageFixture(container, {
        source: "attachments/screen-photo.png",
        label: "480x320"
      });
    });
    const container = document.createElement("div");
    const scope = new Component();
    scope.load();

    await renderRecord(
      container,
      record,
      "![[attachments/screen-photo.png|480x320]]",
      { workspace: { openLinkText: vi.fn() } } as never,
      "thread.md",
      scope,
      () => {},
      () => {},
      () => {}
    );

    const embed = container.querySelector<HTMLElement>(".floor-notes-body .image-embed");
    expect(embed?.hasAttribute("alt")).toBe(false);
    expect(embed?.querySelector(".floor-notes-image-description")).toBeNull();
  });

  it("does not reflow a paragraph that contains both an image and text", async () => {
    vi.spyOn(MarkdownRenderer, "render").mockImplementationOnce(async (_app, _markdown, container) => {
      appendRenderedImageFixture(container, {
        source: "attachments/screen-photo.png",
        label: "screen-photo.png",
        trailingText: "副屏配件"
      });
    });
    const container = document.createElement("div");
    const scope = new Component();
    scope.load();

    await renderRecord(
      container,
      record,
      "![[attachments/screen-photo.png]] 副屏配件",
      { workspace: { openLinkText: vi.fn() } } as never,
      "thread.md",
      scope,
      () => {},
      () => {},
      () => {}
    );

    const paragraph = container.querySelector<HTMLParagraphElement>(".floor-notes-body p");
    expect(paragraph?.classList.contains("floor-notes-image-paragraph")).toBe(false);
    expect(paragraph?.textContent).toContain("副屏配件");
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
