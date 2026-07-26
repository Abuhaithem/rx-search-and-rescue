import { describe, expect, it } from "vitest";
import { getExtractionProvider } from "./index";

const baseEnv = {
  ANTHROPIC_API_KEY: "sk-ant-test",
  OPENAI_API_KEY: "sk-openai-test",
  GEMINI_API_KEY: "gemini-test",
} as NodeJS.ProcessEnv;

describe("getExtractionProvider", () => {
  it("defaults to anthropic with haiku + sonnet escalation", () => {
    const provider = getExtractionProvider({ ...baseEnv });
    expect(provider.providerName).toBe("anthropic");
    expect(provider.model).toBe("claude-haiku-4-5");
    expect(provider.escalationModel).toBe("claude-sonnet-5");
  });

  it("selects openai and gemini with their defaults", () => {
    const openai = getExtractionProvider({ ...baseEnv, EXTRACTION_PROVIDER: "openai" });
    expect(openai.providerName).toBe("openai");
    expect(openai.model).toBe("gpt-5-mini");
    expect(openai.escalationModel).toBeNull();

    const gemini = getExtractionProvider({ ...baseEnv, EXTRACTION_PROVIDER: "gemini" });
    expect(gemini.providerName).toBe("gemini");
    expect(gemini.model).toBe("gemini-2.5-flash-lite");
    expect(gemini.escalationModel).toBe("gemini-3-flash");
  });

  it("honors EXTRACTION_MODEL and EXTRACTION_ESCALATION_MODEL overrides", () => {
    const provider = getExtractionProvider({
      ...baseEnv,
      EXTRACTION_MODEL: "claude-opus-4-8",
      EXTRACTION_ESCALATION_MODEL: "claude-sonnet-5",
    });
    expect(provider.model).toBe("claude-opus-4-8");
    expect(provider.escalationModel).toBe("claude-sonnet-5");

    const openai = getExtractionProvider({
      ...baseEnv,
      EXTRACTION_PROVIDER: "openai",
      EXTRACTION_ESCALATION_MODEL: "some-top-openai-model",
    });
    expect(openai.escalationModel).toBe("some-top-openai-model");
  });

  it("disables escalation when EXTRACTION_ESCALATION_MODEL is empty", () => {
    const provider = getExtractionProvider({
      ...baseEnv,
      EXTRACTION_ESCALATION_MODEL: "",
    });
    expect(provider.escalationModel).toBeNull();
  });

  it("fails clearly when the selected provider's key is missing", () => {
    expect(() =>
      getExtractionProvider({ EXTRACTION_PROVIDER: "openai" } as NodeJS.ProcessEnv),
    ).toThrow(/OPENAI_API_KEY is not set/);
    expect(() =>
      getExtractionProvider({ EXTRACTION_PROVIDER: "gemini" } as NodeJS.ProcessEnv),
    ).toThrow(/GEMINI_API_KEY is not set/);
    expect(() => getExtractionProvider({} as NodeJS.ProcessEnv)).toThrow(
      /ANTHROPIC_API_KEY is not set/,
    );
  });

  it("rejects unknown provider names", () => {
    expect(() =>
      getExtractionProvider({
        ...baseEnv,
        EXTRACTION_PROVIDER: "deepseek",
      } as NodeJS.ProcessEnv),
    ).toThrow(/Unknown EXTRACTION_PROVIDER "deepseek"/);
  });
});
