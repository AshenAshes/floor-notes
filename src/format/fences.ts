export interface FenceState {
  readonly inFence: boolean;
  readonly markerChar: "`" | "~" | null;
  readonly markerLength: number;
}

export const INITIAL_FENCE_STATE: FenceState = {
  inFence: false,
  markerChar: null,
  markerLength: 0
};

export function updateFenceState(lineText: string, state: FenceState): FenceState {
  let indent = 0;
  while (indent < lineText.length && lineText[indent] === " ") {
    indent++;
  }

  if (indent > 3) {
    return state;
  }

  if (!state.inFence) {
    if (indent >= lineText.length) {
      return state;
    }
    const char = lineText[indent];
    if (char !== "`" && char !== "~") {
      return state;
    }

    let runLength = 0;
    let idx = indent;
    while (idx < lineText.length && lineText[idx] === char) {
      runLength++;
      idx++;
    }

    if (runLength < 3) {
      return state;
    }

    const infoString = lineText.substring(idx);
    if (char === "`" && infoString.includes("`")) {
      return state; // backtick opener info string cannot contain backticks
    }

    return {
      inFence: true,
      markerChar: char,
      markerLength: runLength
    };
  } else {
    if (indent >= lineText.length) {
      return state;
    }
    const char = lineText[indent];
    if (char !== state.markerChar) {
      return state;
    }

    let runLength = 0;
    let idx = indent;
    while (idx < lineText.length && lineText[idx] === char) {
      runLength++;
      idx++;
    }

    if (runLength < state.markerLength) {
      return state;
    }

    const rest = lineText.substring(idx);
    // The rest of the line must be only space or tab
    let allSpaces = true;
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] !== " " && rest[i] !== "\t") {
        allSpaces = false;
        break;
      }
    }

    if (allSpaces) {
      return {
        inFence: false,
        markerChar: null,
        markerLength: 0
      };
    }

    return state;
  }
}
