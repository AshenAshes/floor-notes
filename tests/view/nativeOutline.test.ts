import { describe, expect, it, vi } from "vitest";
import type { HeadingCache } from "obsidian";
import { enhanceOutline } from "../../src/view/NativeOutlineEnhancement";
import { summarizeOutlineBody, type OutlineRecordSummary } from "../../src/view/outlineSummary";
import { setLocale } from "../../src/util/locale";

function item(line: number, heading: string, level: number) {
  const position = { line, col: 0, offset: line * 10 };
  const cache: HeadingCache = { heading, level, position: { start: position, end: position } };
  return {
    heading: cache,
    headingText: heading,
    innerEl: document.createElement("div"),
    onSelfClick: vi.fn(),
    collapsed: true
  };
}

describe("native outline enhancement", () => {
  it("routes the document title to the floor-view start and restores native behavior when inactive", () => {
    const title = item(0, "碎碎念", 1);
    const nativeClick = title.onSelfClick;
    let enabled = true;
    const outline = { file: null, prevQuery: "", cachedHeadingDom: [title], filterSearchResults: vi.fn() };
    const navigate = vi.fn();
    const dispose = enhanceOutline(outline, () => enabled ? new Map() : null, navigate);
    title.onSelfClick(new MouseEvent("click", { cancelable: true }));
    expect(navigate).toHaveBeenCalledWith(null);
    expect(nativeClick).not.toHaveBeenCalled();
    expect(title.headingText).toBe("碎碎念");
    expect(title.collapsed).toBe(true);
    enabled = false;
    outline.filterSearchResults();
    title.onSelfClick(new MouseEvent("click"));
    expect(nativeClick).toHaveBeenCalledOnce();
    dispose();
  });
  it("keeps nodes, collapse state and shared headings while searching summaries and navigating records", () => {
    const floor = item(3, "Floor", 2);
    const reply = item(8, "Reply", 3);
    const originalHeading = floor.heading;
    const originalClick = floor.onSelfClick;
    let enabled = true;
    const summaries = new Map<number, OutlineRecordSummary>([
      [3, { id: "floor-id", text: "A useful summary" }],
      [8, { id: "reply-id", text: "A reply summary" }]
    ]);
    let searched: string[] = [];
    const originalFilter = vi.fn(() => {
      searched = outline.cachedHeadingDom.map((entry) => entry.heading.heading);
    });
    const outline = { file: null, prevQuery: "", cachedHeadingDom: [floor, reply], filterSearchResults: originalFilter };
    const navigate = vi.fn();
    const dispose = enhanceOutline(outline, () => enabled ? summaries : null, navigate);

    expect(searched).toEqual(["A useful summary", "A reply summary"]);
    expect(floor.innerEl.textContent).toBe("A useful summary");
    expect(reply.innerEl.textContent).toBe("A reply summary");
    expect(floor.heading).toBe(originalHeading);
    expect(originalHeading.heading).toBe("Floor");
    expect(floor.collapsed).toBe(true);
    expect(outline.cachedHeadingDom).toEqual([floor, reply]);
    floor.onSelfClick(new MouseEvent("click", { cancelable: true }));
    expect(navigate).toHaveBeenCalledWith("floor-id");
    expect(originalClick).not.toHaveBeenCalled();

    enabled = false;
    outline.filterSearchResults();
    expect(floor.innerEl.textContent).toBe("Floor");
    expect(floor.onSelfClick).toBe(originalClick);
    expect(searched).toEqual(["Floor", "Reply"]);
    dispose();
    expect(outline.filterSearchResults).toBe(originalFilter);
  });

  it("restores heading references even when native search throws", () => {
    const floor = item(3, "Floor", 2);
    const originalHeading = floor.heading;
    const nativeFilter = vi.fn();
    const outline = { file: null, prevQuery: "", cachedHeadingDom: [floor], filterSearchResults: nativeFilter };
    const dispose = enhanceOutline(outline, () => new Map([[3, { id: "id", text: "Summary" }]]), vi.fn());
    nativeFilter.mockImplementationOnce(() => { throw new Error("search failed"); });
    expect(() => outline.filterSearchResults()).toThrow("search failed");
    expect(floor.heading).toBe(originalHeading);
    dispose();
  });

  it("extracts plain summaries and localized fallbacks without splitting emoji", () => {
    setLocale("zh-cn");
    expect(summarizeOutlineBody("**正文** [[note|别名]] [链接](https://example.com)\n\n第二段"))
      .toBe("正文 别名 链接");
    expect(summarizeOutlineBody("![[photo.png|320]]")).toBe("图片");
    expect(summarizeOutlineBody("![[photo.png|海边|320]]")).toBe("海边");
    expect(summarizeOutlineBody("```js\nconst value = 1;\n```" )).toBe("代码片段");
    expect(summarizeOutlineBody("<!-- hidden -->")).toBe("空内容");
    expect(summarizeOutlineBody("😀".repeat(61))).toBe("😀".repeat(60) + "…");
    setLocale("en");
  });
});
