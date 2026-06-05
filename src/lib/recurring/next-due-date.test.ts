import assert from "node:assert/strict";
import test from "node:test";

import { calculateNextDueDate } from "./detector";

test("calculateNextDueDate preserves month-end anchors while fast-forwarding", () => {
  assert.equal(
    calculateNextDueDate("2026-01-31", "monthly", "2026-03-01"),
    "2026-03-31"
  );
  assert.equal(
    calculateNextDueDate("2026-01-31", "quarterly", "2026-05-01"),
    "2026-07-31"
  );
});
