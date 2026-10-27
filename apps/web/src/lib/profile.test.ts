import { describe, expect, it } from "vitest";
import { checkDisplayName, checkPasswordChange, hasErrors, MAX_NAME } from "./profile";

describe("checkDisplayName", () => {
  it("trims and accepts a valid name", () => {
    expect(checkDisplayName("  Maria Silva  ")).toEqual({ ok: true, name: "Maria Silva" });
  });

  it("rejects a name that is too short, empty or only spaces", () => {
    for (const raw of ["", "   ", "a", " b "]) {
      expect(checkDisplayName(raw)).toMatchObject({ ok: false });
    }
  });

  it("accepts the limits and rejects one character above the maximum", () => {
    expect(checkDisplayName("ab")).toMatchObject({ ok: true });
    expect(checkDisplayName("x".repeat(MAX_NAME))).toMatchObject({ ok: true });
    expect(checkDisplayName("x".repeat(MAX_NAME + 1))).toMatchObject({ ok: false });
  });
});

describe("checkPasswordChange", () => {
  const valid = { current: "senha12345", next: "outra-senha-123", confirm: "outra-senha-123" };

  it("accepts a valid change", () => {
    expect(hasErrors(checkPasswordChange(valid))).toBe(false);
  });

  it("requires the current password", () => {
    expect(checkPasswordChange({ ...valid, current: "" }).current).toBeDefined();
  });

  it("requires at least 8 characters in the new password", () => {
    expect(checkPasswordChange({ ...valid, next: "curta", confirm: "curta" }).next).toContain("8");
  });

  it("rejects a new password above 72 bytes (bcrypt), counting bytes and not characters", () => {
    const long = "x".repeat(73);
    expect(checkPasswordChange({ ...valid, next: long, confirm: long }).next).toBeDefined();
    // 40 letras acentuadas = 80 bytes em UTF-8, apesar de só 40 caracteres.
    const accented = "é".repeat(40);
    expect(checkPasswordChange({ ...valid, next: accented, confirm: accented }).next).toBeDefined();
    expect(hasErrors(checkPasswordChange({ ...valid, next: "x".repeat(72), confirm: "x".repeat(72) }))).toBe(false);
  });

  it("rejects a new password equal to the current one", () => {
    expect(checkPasswordChange({ current: "senha12345", next: "senha12345", confirm: "senha12345" }).next).toBeDefined();
  });

  it("requires the confirmation to match", () => {
    const errors = checkPasswordChange({ ...valid, confirm: "diferente-123" });
    expect(errors.confirm).toBeDefined();
    expect(errors.next).toBeUndefined();
  });

  it("does not pile a confirmation error on top of an invalid new password", () => {
    const errors = checkPasswordChange({ current: "senha12345", next: "curta", confirm: "outra" });
    expect(errors.next).toBeDefined();
    expect(errors.confirm).toBeUndefined();
  });
});
