import { describe, expect, it } from "vitest";
import type OpenAI from "openai";
import {
  createOpenAIProvider,
  OPENAI_DEFAULT_MODEL,
  type OpenAIResponsesClient,
} from "./openai";

type CreateParams = OpenAI.Responses.ResponseCreateParamsNonStreaming;

function fakeClient(output: unknown): {
  client: OpenAIResponsesClient;
  requests: CreateParams[];
} {
  const requests: CreateParams[] = [];
  const client: OpenAIResponsesClient = {
    responses: {
      async create(params) {
        requests.push(params);
        return {
          status: "completed",
          output_text: JSON.stringify(output),
        } as unknown as OpenAI.Responses.Response;
      },
    },
  };
  return { client, requests };
}

const validPage = {
  page: 3,
  rows: [
    {
      rawDrugName: "meloxicam oral tablet",
      tier: 1,
      requirementsText: null,
      therapeuticCategory: null,
    },
  ],
};

describe("provider defaults", () => {
  it("defaults to gpt-5-mini with no escalation model", () => {
    const { client } = fakeClient({});
    const provider = createOpenAIProvider({ client });
    expect(provider.providerName).toBe("openai");
    expect(provider.model).toBe(OPENAI_DEFAULT_MODEL);
    expect(provider.model).toBe("gpt-5-mini");
    expect(provider.escalationModel).toBeNull();
    expect(provider.maxContextPages).toBe(50);
  });
});

describe("extractFormularyPage", () => {
  it("sends a base64 file input and requests strict json_schema output", async () => {
    const { client, requests } = fakeClient(validPage);
    const result = await createOpenAIProvider({ client }).extractFormularyPage("cGRm", 3);
    expect(result.rows[0]?.tier).toBe(1);

    const request = requests[0];
    expect(request?.model).toBe("gpt-5-mini");
    expect(request?.instructions).toContain("formulary");

    const input = request?.input;
    if (!Array.isArray(input)) throw new Error("expected input array");
    const message = input[0];
    if (!message || !("content" in message) || !Array.isArray(message.content)) {
      throw new Error("expected message content array");
    }
    const file = message.content[0];
    expect(file?.type).toBe("input_file");
    expect(
      file && "file_data" in file ? file.file_data : "",
    ).toBe("data:application/pdf;base64,cGRm");
    const text = message.content[1];
    expect(text?.type === "input_text" && text.text).toContain("page 3");

    const format = request?.text?.format;
    expect(format?.type).toBe("json_schema");
    if (format?.type !== "json_schema") throw new Error("expected json_schema format");
    expect(format.name).toBe("record_formulary_page");
    expect(format.strict).toBe(true);
    expect(format.schema).toMatchObject({ type: "object", required: ["page", "rows"] });
  });

  it("forces the provenance page number to the requested page", async () => {
    const { client } = fakeClient({ ...validPage, page: 1 });
    const result = await createOpenAIProvider({ client }).extractFormularyPage("cGRm", 9);
    expect(result.page).toBe(9);
  });

  it("uses the per-call model override for escalation", async () => {
    const { client, requests } = fakeClient(validPage);
    await createOpenAIProvider({ client }).extractFormularyPage("cGRm", 3, {
      model: "escalated-model",
    });
    expect(requests[0]?.model).toBe("escalated-model");
  });

  it("rejects malformed output at the zod gate", async () => {
    const { client } = fakeClient({ page: 3, rows: [{ rawDrugName: "", tier: 0 }] });
    await expect(
      createOpenAIProvider({ client }).extractFormularyPage("cGRm", 3),
    ).rejects.toThrow();
  });

  it("throws when the response has no output text", async () => {
    const client: OpenAIResponsesClient = {
      responses: {
        async create() {
          return {
            status: "incomplete",
            output_text: "",
          } as unknown as OpenAI.Responses.Response;
        },
      },
    };
    await expect(
      createOpenAIProvider({ client }).extractFormularyPage("cGRm", 1),
    ).rejects.toThrow(/no output text/);
  });
});

describe("extractPharmacyDirectoryRows", () => {
  it("sends text-only input and validates rows", async () => {
    const { client, requests } = fakeClient({
      rows: [
        {
          pharmacyName: "The Drug Store",
          address: null,
          zip: "83333",
          status: "standard",
          statusLabel: "In network - Standard cost share",
        },
      ],
    });
    const result = await createOpenAIProvider({ client }).extractPharmacyDirectoryRows(
      "directory text",
    );
    expect(result.rows[0]?.pharmacyName).toBe("The Drug Store");

    const input = requests[0]?.input;
    if (!Array.isArray(input)) throw new Error("expected input array");
    const message = input[0];
    if (!message || !("content" in message) || !Array.isArray(message.content)) {
      throw new Error("expected message content array");
    }
    expect(message.content).toHaveLength(1);
    expect(message.content[0]?.type).toBe("input_text");
  });
});
