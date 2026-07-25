import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { createExtractor, type ClaudeMessagesClient } from "./anthropic";

type CreateParams = Anthropic.Messages.MessageCreateParamsNonStreaming;

function fakeClient(toolInputByName: Record<string, unknown>): {
  client: ClaudeMessagesClient;
  requests: CreateParams[];
} {
  const requests: CreateParams[] = [];
  const client: ClaudeMessagesClient = {
    messages: {
      async create(params) {
        requests.push(params);
        const choice = params.tool_choice;
        const name =
          choice && choice.type === "tool" ? choice.name : "unknown_tool";
        const message = {
          content: [{ type: "tool_use", id: "toolu_1", name, input: toolInputByName[name] }],
          stop_reason: "tool_use",
        };
        return message as unknown as Anthropic.Messages.Message;
      },
    },
  };
  return { client, requests };
}

const validRxc = {
  clientName: "Marilyn Healy",
  zip: "83333",
  takesPrescriptions: true,
  preferredPharmacies: ["The Drug Store - 91 E Croy Hailey ID 83333"],
  deliveryPreferred: false,
  medications: [
    {
      name: "Eliquis",
      dosageText: "Eliquis TAB 2.5MG",
      quantity: 60,
      daysSupply: 30,
      genericOk: true,
      prn: false,
      source: "structured",
      confidence: 0.98,
      rawText: "Eliquis | Eliquis TAB 2.5MG | 60 | 30 | Yes",
    },
  ],
  inForcePolicies: [
    {
      rawText: "Humana - H94324997 - PDP",
      carrierName: "Humana",
      policyNumber: "H94324997",
      policyType: "pdp",
    },
  ],
};

describe("extractRxc", () => {
  it("returns the zod-validated extraction from the forced tool call", async () => {
    const { client, requests } = fakeClient({ record_rxc_extraction: validRxc });
    const extractor = createExtractor({ client });
    const result = await extractor.extractRxc("cGRm");
    expect(result.clientName).toBe("Marilyn Healy");
    expect(result.medications[0]?.prn).toBe(false);

    const request = requests[0];
    expect(request?.model).toBe("claude-opus-4-8");
    expect(request?.tool_choice).toEqual({ type: "tool", name: "record_rxc_extraction" });
    const content = request?.messages[0]?.content;
    expect(Array.isArray(content) && content[0]?.type).toBe("document");
  });

  it("rejects payloads that violate the contract", async () => {
    const { client } = fakeClient({
      record_rxc_extraction: { ...validRxc, zip: "not-a-zip" },
    });
    await expect(createExtractor({ client }).extractRxc("cGRm")).rejects.toThrow();
  });

  it("throws when Claude returns no tool call", async () => {
    const client: ClaudeMessagesClient = {
      messages: {
        async create() {
          return {
            content: [{ type: "text", text: "I cannot do that" }],
            stop_reason: "end_turn",
          } as unknown as Anthropic.Messages.Message;
        },
      },
    };
    await expect(createExtractor({ client }).extractRxc("cGRm")).rejects.toThrow(
      /no record_rxc_extraction tool call/,
    );
  });
});

describe("extractFormularyPage", () => {
  const page = {
    page: 42,
    rows: [
      {
        rawDrugName: "tramadol hcl oral tablet 50 mg",
        tier: 3,
        requirementsText: "QL (240 per 30 days); NEDS",
        therapeuticCategory: "ANALGESICS",
      },
    ],
  };

  it("caches the shared prompt prefix and the document", async () => {
    const { client, requests } = fakeClient({ record_formulary_page: page });
    const result = await createExtractor({ client }).extractFormularyPage("cGRm", 42);
    expect(result.rows).toHaveLength(1);

    const request = requests[0];
    const system = request?.system;
    expect(Array.isArray(system) && system[0]?.cache_control).toEqual({ type: "ephemeral" });
    const content = request?.messages[0]?.content;
    if (!Array.isArray(content)) throw new Error("expected content array");
    const doc = content[0];
    expect(doc?.type).toBe("document");
    expect(doc && "cache_control" in doc ? doc.cache_control : null).toEqual({
      type: "ephemeral",
    });
    expect(content[1]?.type === "text" && content[1].text).toContain("page 42");
  });

  it("forces the provenance page number to the requested page", async () => {
    const { client } = fakeClient({
      record_formulary_page: { ...page, page: 7 },
    });
    const result = await createExtractor({ client }).extractFormularyPage("cGRm", 42);
    expect(result.page).toBe(42);
  });

  it("rejects tiers outside 1-6", async () => {
    const bad = { page: 1, rows: [{ ...page.rows[0], tier: 9 }] };
    const { client } = fakeClient({ record_formulary_page: bad });
    await expect(
      createExtractor({ client }).extractFormularyPage("cGRm", 1),
    ).rejects.toThrow();
  });
});

describe("extractFormularyLegend", () => {
  it("validates legend entries", async () => {
    const { client } = fakeClient({
      record_formulary_legend: {
        entries: [{ code: "NM", definition: "Not available at mail order" }],
      },
    });
    const result = await createExtractor({ client }).extractFormularyLegend("cGRm");
    expect(result.entries[0]?.code).toBe("NM");
  });
});

describe("extractPharmacyDirectoryRows", () => {
  it("validates directory rows and sends text content", async () => {
    const { client, requests } = fakeClient({
      record_pharmacy_directory: {
        rows: [
          {
            pharmacyName: "The Drug Store",
            address: "91 E Croy St",
            zip: "83333",
            status: "preferred",
          },
        ],
      },
    });
    const result = await createExtractor({ client }).extractPharmacyDirectoryRows(
      "--- page 1 ---\nThe Drug Store ...",
    );
    expect(result.rows[0]?.status).toBe("preferred");
    const content = requests[0]?.messages[0]?.content;
    expect(Array.isArray(content) && content[0]?.type).toBe("text");
  });

  it("rejects unknown network statuses", async () => {
    const { client } = fakeClient({
      record_pharmacy_directory: {
        rows: [{ pharmacyName: "X", address: null, zip: null, status: "vip" }],
      },
    });
    await expect(
      createExtractor({ client }).extractPharmacyDirectoryRows("text"),
    ).rejects.toThrow();
  });
});
