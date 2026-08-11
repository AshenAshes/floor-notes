import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { FormattingCommandId, runFormattingCommand } from "../../src/editor/formattingCommands";

let activeView: EditorView | null = null;

function createView(text: string, from: number, to = from): EditorView {
  activeView = new EditorView({
    state: EditorState.create({
      doc: text,
      selection: { anchor: from, head: to }
    }),
    parent: document.body
  });
  return activeView;
}

function run(text: string, from: number, to: number, command: FormattingCommandId): EditorView {
  const view = createView(text, from, to);
  expect(runFormattingCommand(view, command)).toBe(true);
  return view;
}

afterEach(() => {
  activeView?.destroy();
  activeView = null;
  document.body.replaceChildren();
});

describe("formatting commands", () => {
  it.each([
    ["bold", "**"],
    ["italic", "*"],
    ["strikethrough", "~~"]
  ] as const)("wraps and unwraps the primary selection for %s", (command, marker) => {
    const wrapped = run("hello", 0, 5, command);
    expect(wrapped.state.doc.toString()).toBe(`${marker}hello${marker}`);
    expect(wrapped.state.selection.main.from).toBe(marker.length);
    expect(wrapped.state.selection.main.to).toBe(marker.length + 5);

    wrapped.dispatch({ selection: { anchor: 0, head: wrapped.state.doc.length } });
    runFormattingCommand(wrapped, command);
    expect(wrapped.state.doc.toString()).toBe("hello");
    expect(wrapped.state.selection.main.from).toBe(0);
    expect(wrapped.state.selection.main.to).toBe(5);
  });

  it("inserts paired markers at an empty selection and places the caret inside", () => {
    const view = run("ab", 1, 1, "strikethrough");

    expect(view.state.doc.toString()).toBe("a~~~~b");
    expect(view.state.selection.main.anchor).toBe(3);
  });

  it("inserts a Markdown link and places the caret in the URL", () => {
    const selected = run("hello", 0, 5, "link");
    expect(selected.state.doc.toString()).toBe("[hello]()");
    expect(selected.state.selection.main.anchor).toBe(8);

    selected.destroy();
    activeView = null;
    const empty = run("ab", 1, 1, "link");
    expect(empty.state.doc.toString()).toBe("a[]()b");
    expect(empty.state.selection.main.anchor).toBe(4);
  });
});
