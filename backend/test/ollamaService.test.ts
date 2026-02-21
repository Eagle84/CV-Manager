import assert from "node:assert/strict";
import { describe, it, afterEach } from "node:test";
import { extractWithOllama, normalizeSubjectForGroup } from "../src/services/ollamaService.js";

const ORIGINAL_FETCH = globalThis.fetch;

const setFetchMock = (impl: typeof fetch): void => {
  Object.defineProperty(globalThis, "fetch", {
    value: impl,
    configurable: true,
    writable: true,
  });
};

afterEach(() => {
  setFetchMock(ORIGINAL_FETCH);
});

describe("ollamaService", () => {
  it("parses valid JSON extraction payload", async () => {
    setFetchMock(
      (async () =>
        ({
          ok: true,
          json: async () => ({
            response: JSON.stringify({
              include: true,
              companyName: "Acme",
              companyDomain: "acme.com",
              roleTitle: "Software Engineer",
              status: "received",
              normalizedSubjectKey: "acme-software-engineer",
              confidence: 0.91,
            }),
          }),
        }) as Response) as typeof fetch,
    );

    const result = await extractWithOllama({
      subject: "Thanks for applying to Acme",
      body: "We received your application.",
      fromEmail: "jobs@acme.com",
      fromDisplayName: "Acme Recruiting",
      senderDomain: "acme.com",
    });

    assert.equal(result.ok, true);
    assert.equal(result.value?.include, true);
    assert.equal(result.value?.companyName, "Acme");
    assert.equal(result.value?.confidence, 0.91);
  });

  it("retries once when first response is not valid JSON", async () => {
    let attempts = 0;
    setFetchMock(
      (async () => {
        attempts += 1;
        return {
          ok: true,
          json: async () => ({
            response:
              attempts === 1
                ? "not-json"
                : JSON.stringify({
                    include: true,
                    companyName: "Beta",
                    companyDomain: "beta.com",
                    roleTitle: "Developer",
                    status: "received",
                    normalizedSubjectKey: "beta-developer",
                    confidence: 0.75,
                  }),
          }),
        } as Response;
      }) as typeof fetch,
    );

    const result = await extractWithOllama({
      subject: "Thanks for applying to Beta",
      body: "Application received.",
      fromEmail: "noreply@beta.com",
      fromDisplayName: "Beta",
      senderDomain: "beta.com",
    });

    assert.equal(result.ok, true);
    assert.equal(attempts, 2);
  });

  it("returns error on network failure", async () => {
    let attempts = 0;
    setFetchMock(
      (async () => {
        attempts += 1;
        throw new Error("network failed");
      }) as typeof fetch,
    );

    const result = await extractWithOllama({
      subject: "Thanks for applying",
      body: "Body",
      fromEmail: "jobs@example.com",
      fromDisplayName: "Example",
      senderDomain: "example.com",
    });

    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /network failed/i);
    assert.equal(attempts, 1);
  });

  it("normalizes subject variants to stable grouping key", () => {
    const a = normalizeSubjectForGroup("Thanks for applying to Acme - Software Engineer");
    const b = normalizeSubjectForGroup("RE: Thanks for applying for Acme, Software Engineer!");
    const c = normalizeSubjectForGroup("Fwd: thanks for applying to acme software engineer");

    assert.equal(a, "acme-software-engineer");
    assert.equal(b, "acme-software-engineer");
    assert.equal(c, "acme-software-engineer");
  });
});
