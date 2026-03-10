import assert from "node:assert/strict";
import test from "node:test";
import { getSuggestedFeatures } from "./featureSuggestions";

test("getSuggestedFeatures filters duplicates and applies the current prefix", () => {
  assert.deepEqual(
    getSuggestedFeatures(
      ["alloc", "derive", "std"],
      "d",
      ["std"]
    ),
    ["derive"]
  );
});

test("getSuggestedFeatures returns all remaining features for an empty prefix", () => {
  assert.deepEqual(
    getSuggestedFeatures(
      ["alloc", "derive", "std"],
      "",
      ["derive"]
    ),
    ["alloc", "std"]
  );
});
