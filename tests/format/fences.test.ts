import { describe, it, expect } from "vitest";
import { updateFenceState, INITIAL_FENCE_STATE } from "../../src/format/fences";

describe("T-052: CommonMark code fence boundary tracking", () => {
  it("should detect basic backtick opener and closer", () => {
    let state = INITIAL_FENCE_STATE;
    state = updateFenceState("```js", state);
    expect(state.inFence).toBe(true);
    expect(state.markerChar).toBe("`");
    expect(state.markerLength).toBe(3);

    state = updateFenceState("const x = 1;", state);
    expect(state.inFence).toBe(true);

    state = updateFenceState("```", state);
    expect(state.inFence).toBe(false);
    expect(state.markerChar).toBeNull();
  });

  it("should respect maximal run length and require closer of at least same length", () => {
    let state = INITIAL_FENCE_STATE;
    // Opener is 4 backticks
    state = updateFenceState("````", state);
    expect(state.inFence).toBe(true);
    expect(state.markerLength).toBe(4);

    // Closer of 3 backticks should not close it
    state = updateFenceState("```", state);
    expect(state.inFence).toBe(true);

    // Closer of 5 backticks should close it (since length >= 4)
    state = updateFenceState("`````", state);
    expect(state.inFence).toBe(false);
  });

  it("should not open if backtick opener info string contains backticks", () => {
    let state = INITIAL_FENCE_STATE;
    state = updateFenceState("```js `invalid`", state);
    expect(state.inFence).toBe(false);
  });

  it("should open if tilde opener info string contains tildes", () => {
    let state = INITIAL_FENCE_STATE;
    state = updateFenceState("~~~js ~invalid~", state);
    expect(state.inFence).toBe(true);
    expect(state.markerChar).toBe("~");
  });

  it("should require closing fence to have only spaces or tabs trailing the run", () => {
    let state = INITIAL_FENCE_STATE;
    state = updateFenceState("```", state);
    expect(state.inFence).toBe(true);

    // Trailer with non-whitespace
    state = updateFenceState("``` trailing", state);
    expect(state.inFence).toBe(true);

    // Trailer with tabs and spaces is OK
    state = updateFenceState("``` \t ", state);
    expect(state.inFence).toBe(false);
  });

  it("should ignore lines with more than 3 leading spaces", () => {
    let state = INITIAL_FENCE_STATE;
    state = updateFenceState("    ```", state); // 4 spaces
    expect(state.inFence).toBe(false);
  });
});
