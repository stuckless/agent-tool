import { describe, expect, it } from "vitest";

import { placeholderHandler } from "../src/cli.js";

describe("placeholderHandler", () => {
  it("returns the supplied prompt", () => {
    expect(placeholderHandler("hello")).toBe("hello");
  });
});
