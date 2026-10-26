import { describe, expect, it } from "vitest";
import { safeRedirect } from "./redirect";

describe("safeRedirect", () => {
  it("keeps internal paths, including query strings", () => {
    expect(safeRedirect("/wallet")).toBe("/wallet");
    expect(safeRedirect("/lots/abc?tab=history")).toBe("/lots/abc?tab=history");
  });

  it("falls back for anything that is not an internal path (open-redirect protection)", () => {
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example","javascript:alert(1)", "evil", ""]) {
      expect(safeRedirect(bad), bad).toBe("/");
    }
  });

  it("falls back for missing or non-string values", () => {
    expect(safeRedirect(undefined)).toBe("/");
    expect(safeRedirect(null)).toBe("/");
    expect(safeRedirect({ from: "/wallet" })).toBe("/");
  });

  it("does not send the user back to the login or signup screens (no loops)", () => {
    expect(safeRedirect("/login")).toBe("/");
    expect(safeRedirect("/signup")).toBe("/");
    expect(safeRedirect("/login", "/wins")).toBe("/wins");
  });
});
