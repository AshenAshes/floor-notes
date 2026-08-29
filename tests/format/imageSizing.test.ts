import { describe, expect, it } from "vitest";
import { parseThreadDocument } from "../../src/format/parser";
import {
  indexResizableImages,
  normalizeMarkdownImageTargets,
  setImageSize
} from "../../src/format/imageSizing";

describe("T-076: Direct image source index", () => {
  it("indexes multiple Wiki images with descriptions and terminal width dimensions", () => {
    const body = [
      "- ![[assets/one image.png|First description|320x180]]",
      "> ![[assets/two.webp|Second description]]"
    ].join("\n");
    const firstToken = "![[assets/one image.png|First description|320x180]]";
    const secondToken = "![[assets/two.webp|Second description]]";
    const firstStart = body.indexOf(firstToken);
    const secondStart = body.indexOf(secondToken);

    expect(indexResizableImages(body)).toEqual([
      {
        syntax: "wiki",
        relativeSpan: { start: firstStart, end: firstStart + firstToken.length },
        originalToken: firstToken,
        target: "assets/one image.png",
        targetSpan: {
          start: firstStart + 3,
          end: firstStart + 3 + "assets/one image.png".length
        },
        sizeInsertionOffset: firstStart + firstToken.length - 2,
        sizeSegmentSpan: {
          start: body.indexOf("|320x180"),
          end: body.indexOf("|320x180") + "|320x180".length
        },
        sizeValueSpan: {
          start: body.indexOf("320x180"),
          end: body.indexOf("320x180") + "320x180".length
        },
        width: 320,
        height: 180
      },
      {
        syntax: "wiki",
        relativeSpan: { start: secondStart, end: secondStart + secondToken.length },
        originalToken: secondToken,
        target: "assets/two.webp",
        targetSpan: {
          start: secondStart + 3,
          end: secondStart + 3 + "assets/two.webp".length
        },
        sizeInsertionOffset: secondStart + secondToken.length - 2,
        sizeSegmentSpan: null,
        sizeValueSpan: null,
        width: null,
        height: null
      }
    ]);
  });

  it("indexes linked inline Markdown images without losing URL, title, or escaping", () => {
    const firstToken = "![Diagram \\[draft\\]|240x120](<https://cdn.example/a_(1).png> \"A \\\"title\\\"\")";
    const secondToken = "![Plain](images/a\\(b\\).png 'kept title')";
    const body = `[${firstToken}](https://example.com) and ${secondToken}`;
    const firstStart = body.indexOf(firstToken);
    const secondStart = body.indexOf(secondToken);
    const firstTarget = "https://cdn.example/a_(1).png";
    const secondTarget = "images/a\\(b\\).png";

    expect(indexResizableImages(body)).toEqual([
      {
        syntax: "markdown",
        relativeSpan: { start: firstStart, end: firstStart + firstToken.length },
        originalToken: firstToken,
        target: firstTarget,
        targetSpan: {
          start: body.indexOf(firstTarget),
          end: body.indexOf(firstTarget) + firstTarget.length
        },
        sizeInsertionOffset: body.indexOf("](", firstStart),
        sizeSegmentSpan: {
          start: body.indexOf("|240x120"),
          end: body.indexOf("|240x120") + "|240x120".length
        },
        sizeValueSpan: {
          start: body.indexOf("240x120"),
          end: body.indexOf("240x120") + "240x120".length
        },
        width: 240,
        height: 120
      },
      {
        syntax: "markdown",
        relativeSpan: { start: secondStart, end: secondStart + secondToken.length },
        originalToken: secondToken,
        target: secondTarget,
        targetSpan: {
          start: body.indexOf(secondTarget),
          end: body.indexOf(secondTarget) + secondTarget.length
        },
        sizeInsertionOffset: body.indexOf("](", secondStart),
        sizeSegmentSpan: null,
        sizeValueSpan: null,
        width: null,
        height: null
      }
    ]);
  });

  it("indexes Obsidian Markdown image targets that contain unescaped spaces", () => {
    const token = "![Pasted image](Pasted image 1784317969136.png)";

    expect(indexResizableImages(
      "![Pasted image](Pasted%20image%201784317969136.png)"
    )).toHaveLength(1);

    expect(indexResizableImages(token)).toEqual([{
      syntax: "markdown",
      relativeSpan: { start: 0, end: token.length },
      originalToken: token,
      target: "Pasted image 1784317969136.png",
      targetSpan: {
        start: token.indexOf("Pasted image 1784317969136.png", 2),
        end: token.length - 1
      },
      sizeInsertionOffset: token.indexOf("]("),
      sizeSegmentSpan: null,
      sizeValueSpan: null,
      width: null,
      height: null
    }]);
  });

  it("normalizes only relaxed image targets for rendering and keeps titles outside the target", () => {
    const relaxed = "![Pasted image](Pasted image 1784317969136.png \"kept title\")";
    const encoded = "![Pasted image](Pasted%20image%201784317969136.png)";

    expect(normalizeMarkdownImageTargets(relaxed)).toBe(
      "![Pasted image](Pasted%20image%201784317969136.png \"kept title\")"
    );
    expect(indexResizableImages(relaxed)[0]?.target).toBe("Pasted image 1784317969136.png");
    expect(normalizeMarkdownImageTargets(encoded)).toBe(encoded);
  });

  it("excludes code, escaped, reference, HTML, and transcluded images", () => {
    const wikiToken = "![[kept.png]]";
    const markdownToken = "![kept](kept.png)";
    const body = [
      `${wikiToken} and ${markdownToken}`,
      "`![[inline-code.png]]`",
      "\\![[escaped.png]]",
      "<!-- ![comment](comment.png) -->",
      "```md",
      "![[fenced.png]]",
      "```",
      "<div>![html](html.png)</div>",
      "![reference][asset]",
      "[asset]: reference.png",
      "![[embedded-note]]"
    ].join("\n");

    expect(indexResizableImages(body).map((occurrence) => occurrence.originalToken)).toEqual([
      wikiToken,
      markdownToken
    ]);
  });
});

describe("T-077: SetImageSize byte-safe transform", () => {
  it("normalizes only the selected Wiki WxH segment to width-only", () => {
    const body = "A ![[same.png|说明|300x200]] and ![[same.png|另一张|300x200]]";
    const source = [
      "---",
      "floor-notes: 1",
      "---",
      "## Floor",
      "[id:: floor-20260829-120000-abcde123]",
      "[date:: 2026-08-29 12:00:00]",
      "",
      body,
      ""
    ].join("\n");
    const parsed = parseThreadDocument(source, "thread.md");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const record = parsed.doc.records[0]!;
    const occurrence = indexResizableImages(body)[0]!;

    const result = setImageSize(parsed.doc, {
      recordId: record.id,
      expectedBody: body,
      occurrence,
      desiredWidth: 300
    });

    expect(result.type).toBe("applied");
    if (result.type === "applied") {
      expect(result.newText).toBe(source.replace(
        "![[same.png|说明|300x200]]",
        "![[same.png|说明|300]]"
      ));
    }
  });

  it.each([
    ["![[img.png|300]]", "![[img.png]]"],
    ["![[img.png|说明|300x200]]", "![[img.png|说明]]"],
    ["![说明|300](images/a\\(b\\).png \"kept title\")", "![说明](images/a\\(b\\).png \"kept title\")"],
    ["![|300x200](<https://cdn.example/image>)", "![](<https://cdn.example/image>)"]
  ])("resets only the terminal size segment in %s", (token, expectedToken) => {
    const source = [
      "---",
      "floor-notes: 1",
      "---",
      "## Floor",
      "[id:: floor-20260829-120000-abcde123]",
      "[date:: 2026-08-29 12:00:00]",
      "",
      `Before ${token} after`,
      ""
    ].join("\n");
    const parsed = parseThreadDocument(source, "thread.md");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const record = parsed.doc.records[0]!;
    const body = source.substring(record.bodySpan.start, record.bodySpan.end);
    const occurrence = indexResizableImages(body)[0]!;

    const result = setImageSize(parsed.doc, {
      recordId: record.id,
      expectedBody: body,
      occurrence,
      desiredWidth: null
    });

    expect(result.type).toBe("applied");
    if (result.type === "applied") {
      expect(result.newText).toBe(source.replace(token, expectedToken));
    }
  });

  it.each([
    ["![[img.png]]", "![[img.png|275]]"],
    ["![[img.png|说明]]", "![[img.png|说明|275]]"],
    ["![[img.png|150]]", "![[img.png|275]]"],
    ["![说明](images/a\\(b\\).png \"kept title\")", "![说明|275](images/a\\(b\\).png \"kept title\")"],
    [
      "![Pasted image](Pasted image 1784317969136.png)",
      "![Pasted image|275](Pasted%20image%201784317969136.png)"
    ],
    ["![说明|150x90](<https://cdn.example/image> 'kept title')", "![说明|275](<https://cdn.example/image> 'kept title')"]
  ])("writes width-only size without changing other bytes in %s", (token, expectedToken) => {
    const source = [
      "---",
      "floor-notes: 1",
      "---",
      "## Floor",
      "[id:: floor-20260829-120000-abcde123]",
      "[date:: 2026-08-29 12:00:00]",
      "",
      `Before ${token} after`,
      ""
    ].join("\n");
    const parsed = parseThreadDocument(source, "thread.md");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const record = parsed.doc.records[0]!;
    const body = source.substring(record.bodySpan.start, record.bodySpan.end);
    const occurrence = indexResizableImages(body)[0]!;

    const result = setImageSize(parsed.doc, {
      recordId: record.id,
      expectedBody: body,
      occurrence,
      desiredWidth: 275
    });

    expect(result.type).toBe("applied");
    if (result.type === "applied") {
      expect(result.newText).toBe(source.replace(token, expectedToken));
    }
  });

  it("returns no-op for an identical width-only size and for resetting an unsized image", () => {
    const source = [
      "---",
      "floor-notes: 1",
      "---",
      "## Floor",
      "[id:: floor-20260829-120000-abcde123]",
      "[date:: 2026-08-29 12:00:00]",
      "",
      "![[sized.png|275]] and ![plain](plain.png)",
      ""
    ].join("\n");
    const parsed = parseThreadDocument(source, "thread.md");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const record = parsed.doc.records[0]!;
    const body = source.substring(record.bodySpan.start, record.bodySpan.end);
    const occurrences = indexResizableImages(body);

    expect(setImageSize(parsed.doc, {
      recordId: record.id,
      expectedBody: body,
      occurrence: occurrences[0]!,
      desiredWidth: 275
    }).type).toBe("no-op");
    expect(setImageSize(parsed.doc, {
      recordId: record.id,
      expectedBody: body,
      occurrence: occurrences[1]!,
      desiredWidth: null
    }).type).toBe("no-op");
  });

  it("preserves BOM, mixed EOLs, metadata, separators, repeated paths, and terminal state", () => {
    const source = "\uFEFF---\r\n"
      + "floor-notes: 1\n"
      + "---\r\n"
      + "# Thread\r\n\r\n"
      + "## Floor\r\n"
      + "[id:: floor-20260829-120000-abcde123]\r\n"
      + "[date:: 2026-08-29 12:00:00]\r\n"
      + "[custom:: keep exactly]\r\n\r\n"
      + "First ![[assets/photo.png|100]] and second ![[assets/photo.png]]\r\n\r\n"
      + "### Reply\n"
      + "[id:: reply-20260829-120100-bcdef234]\n"
      + "[date:: 2026-08-29 12:01:00]\n\n"
      + "Untouched reply without a terminal EOL.";
    const parsed = parseThreadDocument(source, "thread.md");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const record = parsed.doc.records[0]!;
    const body = source.substring(record.bodySpan.start, record.bodySpan.end);
    const occurrence = indexResizableImages(body)[1]!;

    const result = setImageSize(parsed.doc, {
      recordId: record.id,
      expectedBody: body,
      occurrence,
      desiredWidth: 241
    });

    expect(result.type).toBe("applied");
    if (result.type === "applied") {
      expect(result.newText).toBe(source.replace(
        "second ![[assets/photo.png]]",
        "second ![[assets/photo.png|241]]"
      ));
      expect(result.newText.endsWith("Untouched reply without a terminal EOL.")).toBe(true);
    }
  });
});
