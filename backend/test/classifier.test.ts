import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyEmailContent } from "../src/services/classifier.js";

describe("classifyEmailContent", () => {
  it("detects rejection responses", () => {
    const result = classifyEmailContent(
      "Application update",
      "Unfortunately, we are not moving forward with your application.",
    );

    assert.equal(result.predictedStatus, "rejected");
    assert.ok(result.confidence > 0.5);
  });

  it("detects confirmations as received", () => {
    const result = classifyEmailContent(
      "Thanks for applying",
      "Thank you for applying. We received your application submitted today.",
    );

    assert.equal(result.predictedStatus, "received");
    assert.equal(result.isConfirmation, true);
  });

  it("detects approvals as offer", () => {
    const result = classifyEmailContent(
      "Application approved",
      "We are pleased to inform you that you were selected and approved for this role.",
    );

    assert.equal(result.predictedStatus, "offer");
    assert.ok(result.confidence > 0.5);
  });
});
