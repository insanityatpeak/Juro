import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { isHearingId, readObject } from "./http";

const req = (body: string) => new NextRequest("http://localhost/api/x", { method: "POST", body });

test("readObject accepts only JSON objects", async () => {
  assert.deepEqual(await readObject(req('{"a":1}')), { a: 1 });
  assert.equal(await readObject(req("null")), null);
  assert.equal(await readObject(req("[1,2]")), null);
  assert.equal(await readObject(req('"text"')), null);
  assert.equal(await readObject(req("42")), null);
  assert.equal(await readObject(req("{not json")), null);
  assert.equal(await readObject(req("")), null);
});

test("hearing ids must be UUIDs", () => {
  assert.equal(isHearingId("3f2b8c1e-9d4a-4e6f-8b7c-1a2d3e4f5a6b"), true);
  assert.equal(isHearingId("../etc"), false);
  assert.equal(isHearingId(""), false);
});
