import { describe, expect, it } from "vitest";
import { parseDosageText } from "./dosage";

describe("parseDosageText", () => {
  it("parses the standard RxC dosage shape", () => {
    expect(parseDosageText("Eliquis TAB 2.5MG")).toEqual({
      strength: "2.5MG",
      form: "tab",
    });
  });

  it("parses complex strengths", () => {
    expect(
      parseDosageText("diltiazem hydrochloride er (extended release beads) CAP 240MG/24"),
    ).toEqual({ strength: "240MG/24", form: "cap" });
  });

  it("parses ER-suffixed strengths", () => {
    expect(parseDosageText("metoprolol succinate er TAB 50MG ER")).toEqual({
      strength: "50MG ER",
      form: "tab",
    });
  });

  it("handles missing dosage text", () => {
    expect(parseDosageText(null)).toEqual({ strength: null, form: null });
  });

  it("handles text without recognizable segments", () => {
    expect(parseDosageText("hydrocort")).toEqual({ strength: null, form: null });
  });

  it("parses parenthesized forms", () => {
    expect(parseDosageText("hydrocortisone (Tablets) TAB 10MG")).toEqual({
      strength: "10MG",
      form: "tablets",
    });
  });
});
