import { EditorView } from "@codemirror/view";

export const FORMATTING_COMMANDS = ["bold", "italic", "strikethrough", "link"] as const;

export type FormattingCommandId = typeof FORMATTING_COMMANDS[number];

const FORMAT_MARKERS: Readonly<Partial<Record<FormattingCommandId, string>>> = {
  bold: "**",
  italic: "*",
  strikethrough: "~~"
};

function toggleMarker(view: EditorView, marker: string): void {
  const state = view.state;
  const { from, to } = state.selection.main;
  const markerLength = marker.length;
  const selectedText = state.doc.sliceString(from, to);

  if (
    selectedText.length >= markerLength * 2
    && selectedText.startsWith(marker)
    && selectedText.endsWith(marker)
  ) {
    const unwrapped = selectedText.slice(markerLength, -markerLength);
    view.dispatch({
      changes: { from, to, insert: unwrapped },
      selection: { anchor: from, head: from + unwrapped.length }
    });
  } else {
    const beforeText = state.doc.sliceString(Math.max(0, from - markerLength), from);
    const afterText = state.doc.sliceString(to, Math.min(state.doc.length, to + markerLength));

    if (beforeText === marker && afterText === marker) {
      view.dispatch({
        changes: { from: from - markerLength, to: to + markerLength, insert: selectedText },
        selection: { anchor: from - markerLength, head: from - markerLength + selectedText.length }
      });
    } else {
      const wrapped = `${marker}${selectedText}${marker}`;
      view.dispatch({
        changes: { from, to, insert: wrapped },
        selection: { anchor: from + markerLength, head: from + markerLength + selectedText.length }
      });
    }
  }
}

function insertLink(view: EditorView): void {
  const state = view.state;
  const { from, to } = state.selection.main;
  const selectedText = state.doc.sliceString(from, to);
  const markdownLink = `[${selectedText}]()`;
  const cursorPosition = from + selectedText.length + 3;

  view.dispatch({
    changes: { from, to, insert: markdownLink },
    selection: { anchor: cursorPosition }
  });
}

export function runFormattingCommand(view: EditorView, command: FormattingCommandId): boolean {
  if (command === "link") {
    insertLink(view);
  } else {
    const marker = FORMAT_MARKERS[command];
    if (!marker) {
      return false;
    }
    toggleMarker(view, marker);
  }

  view.focus();
  return true;
}
