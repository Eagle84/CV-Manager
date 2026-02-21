import assert from "node:assert/strict";
import { describe, it } from "node:test";
import request from "supertest";
import { createApp } from "../src/app.js";

describe("health endpoint", () => {
  it("returns healthy response", async () => {
    const app = createApp();
    const response = await request(app).get("/api/health");

    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
  });

  it("allows localhost frontend origin for CORS", async () => {
    const app = createApp();
    const response = await request(app)
      .get("/api/health")
      .set("Origin", "http://localhost:5173");

    assert.equal(response.status, 200);
    assert.equal(response.headers["access-control-allow-origin"], "http://localhost:5173");
  });
});
