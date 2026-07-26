import { describe, expect, it } from "vitest";
import type { GenerateContentParameters, GenerateContentResponse } from "@google/genai";
import {
  createGeminiProvider,
  GEMINI_DEFAULT_ESCALATION_MODEL,
  GEMINI_DEFAULT_MODEL,
  type GeminiModelsClient,
} from "./gemini";

function fakeClient(output: unknown): {
  client: GeminiModelsClient;
  requests: GenerateContentParameters[];
} {
  const requests: GenerateContentParameters[] = [];
  const client: GeminiModelsClient = {
    models: {
      async generateContent(params) {
        requests.push(params);
        return {
          text: JSON.stringify(output),
        } as unknown as GenerateContentResponse;
      },
    },
  };
  return { client, requests };
}

const validPage = {
  page: 5,
  rows: [
    {
      rawDrugName: "ALECENSA",
      tier: 5,
      requirementsText: "PA; QL (240 per 30 days); NM",
      therapeuticCategory: "ANTINEOPLASTICS",
    },
  ],
};

describe("provider defaults", () => {
  it("defaults to flash-lite with gemini-3-flash escalation and no chunking", () => {
    const { client } = fakeClient({});
    const provider = createGeminiProvider({ client });
    expect(provider.providerName).toBe("gemini");
    expect(provider.model).toBe(GEMINI_DEFAULT_MODEL);
    expect(provider.model).toBe("gemini-2.5-flash-lite");
    expect(provider.escalationModel).toBe(GEMINI_DEFAULT_ESCALATION_MODEL);
    expect(provider.escalationModel).toBe("gemini-3-flash");
    expect(provider.maxContextPages).toBeUndefined();
  });

  it("supports disabling escalation", () => {
    const { client } = fakeClient({});
    expect(createGeminiProvider({ client, escalationModel: null }).escalationModel).toBeNull();
  });
});

describe("extractFormularyPage", () => {
  it("sends inlineData PDF and requests JSON schema enforcement", async () => {
    const { client, requests } = fakeClient(validPage);
    const result = await createGeminiProvider({ client }).extractFormularyPage("cGRm", 5);
    expect(result.rows[0]?.rawDrugName).toBe("ALECENSA");

    const request = requests[0];
    expect(request?.model).toBe("gemini-2.5-flash-lite");

    const contents = request?.contents;
    if (!Array.isArray(contents)) throw new Error("expected contents array");
    const first = contents[0];
    if (!first || typeof first !== "object" || !("parts" in first)) {
      throw new Error("expected content with parts");
    }
    const parts = first.parts;
    if (!Array.isArray(parts)) throw new Error("expected parts array");
    expect(parts[0]?.inlineData).toEqual({
      mimeType: "application/pdf",
      data: "cGRm",
    });
    expect(parts[1]?.text).toContain("page 5");

    expect(request?.config?.responseMimeType).toBe("application/json");
    expect(request?.config?.responseJsonSchema).toMatchObject({
      type: "object",
      required: ["page", "rows"],
    });
    expect(request?.config?.systemInstruction).toContain("formulary");
  });

  it("forces the provenance page number to the requested page", async () => {
    const { client } = fakeClient({ ...validPage, page: 1 });
    const result = await createGeminiProvider({ client }).extractFormularyPage("cGRm", 5);
    expect(result.page).toBe(5);
  });

  it("uses the per-call model override for escalation", async () => {
    const { client, requests } = fakeClient(validPage);
    await createGeminiProvider({ client }).extractFormularyPage("cGRm", 5, {
      model: "gemini-3-flash",
    });
    expect(requests[0]?.model).toBe("gemini-3-flash");
  });

  it("rejects malformed output at the zod gate", async () => {
    const { client } = fakeClient({ page: 5, rows: [{ rawDrugName: "x", tier: 99 }] });
    await expect(
      createGeminiProvider({ client }).extractFormularyPage("cGRm", 5),
    ).rejects.toThrow();
  });

  it("throws when the response has no text", async () => {
    const client: GeminiModelsClient = {
      models: {
        async generateContent() {
          return { text: undefined } as unknown as GenerateContentResponse;
        },
      },
    };
    await expect(
      createGeminiProvider({ client }).extractFormularyPage("cGRm", 1),
    ).rejects.toThrow(/no output text/);
  });
});

describe("extractRxc", () => {
  it("rejects contract violations from JSON output", async () => {
    const { client } = fakeClient({ clientName: "" });
    await expect(createGeminiProvider({ client }).extractRxc("cGRm")).rejects.toThrow();
  });
});
