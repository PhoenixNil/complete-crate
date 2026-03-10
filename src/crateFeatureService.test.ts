import assert from "node:assert/strict";
import test from "node:test";
import {
  CrateFeatureService,
  cargoRequirementToSemverRange,
  getFeatureNames,
  getSparseIndexPath,
  resolveVersionRecord,
  type SparseIndexVersionRecord,
} from "./crateFeatureService";

test("cargoRequirementToSemverRange converts Cargo shorthand requirements", () => {
  assert.equal(cargoRequirementToSemverRange("1"), ">=1.0.0 <2.0.0-0");
  assert.equal(cargoRequirementToSemverRange("1.0"), ">=1.0.0 <2.0.0-0");
  assert.equal(cargoRequirementToSemverRange("^1.2"), ">=1.2.0 <2.0.0-0");
  assert.equal(cargoRequirementToSemverRange("~1.2"), ">=1.2.0 <1.3.0-0");
  assert.equal(cargoRequirementToSemverRange("=1.2.3"), "1.2.3");
});

test("resolveVersionRecord matches the latest compatible non-yanked release", () => {
  const records: SparseIndexVersionRecord[] = [
    { vers: "1.0.0" },
    { vers: "1.2.3" },
    { vers: "1.3.0", yanked: true },
    { vers: "1.9.1" },
    { vers: "2.0.0" },
  ];

  assert.equal(resolveVersionRecord(records, "=1.2.3")?.vers, "1.2.3");
  assert.equal(resolveVersionRecord(records, "1")?.vers, "1.9.1");
  assert.equal(resolveVersionRecord(records, "^1.0")?.vers, "1.9.1");
  assert.equal(resolveVersionRecord(records, "~1.2")?.vers, "1.2.3");
  assert.equal(resolveVersionRecord(records, "invalid"), null);
});

test("getFeatureNames merges features and features2 deterministically", () => {
  assert.deepEqual(
    getFeatureNames({
      vers: "1.0.0",
      features: {
        derive: [],
        std: [],
      },
      features2: {
        alloc: [],
        std: [],
      },
    }),
    ["alloc", "derive", "std"]
  );
});

test("getSparseIndexPath follows crates.io sparse index layout", () => {
  assert.equal(getSparseIndexPath("a"), "1/a");
  assert.equal(getSparseIndexPath("ab"), "2/ab");
  assert.equal(getSparseIndexPath("abc"), "3/a/abc");
  assert.equal(getSparseIndexPath("serde"), "se/rd/serde");
});

test("CrateFeatureService caches crate payloads and reuses resolved feature sets", async () => {
  let requestCount = 0;
  const payload = [
    JSON.stringify({
      vers: "1.0.0",
      features: { derive: [] },
    }),
    JSON.stringify({
      vers: "1.2.0",
      features: { derive: [], std: [] },
      features2: { alloc: [] },
    }),
    JSON.stringify({
      vers: "2.0.0",
      features: { unstable: [] },
    }),
  ].join("\n");

  const service = new CrateFeatureService(async () => {
    requestCount++;
    return Buffer.from(payload, "utf-8");
  });

  const first = await service.getFeatures("serde", "1");
  const second = await service.getFeatures("serde", "^1.0");
  const third = await service.getFeatures("serde", "1");

  assert.deepEqual(first, ["alloc", "derive", "std"]);
  assert.deepEqual(second, ["alloc", "derive", "std"]);
  assert.deepEqual(third, ["alloc", "derive", "std"]);
  assert.equal(requestCount, 1);
});

test("CrateFeatureService deduplicates in-flight crate fetches", async () => {
  let requestCount = 0;
  let releaseRequest: () => void = () => {
    throw new Error("releaseRequest was not initialized");
  };
  const payload = JSON.stringify({
    vers: "1.0.0",
    features: { derive: [] },
  });

  const service = new CrateFeatureService(
    async () =>
      new Promise<Buffer>((resolve) => {
        requestCount++;
        releaseRequest = () => resolve(Buffer.from(payload, "utf-8"));
      })
  );

  const pendingRequests = Promise.all([
    service.getFeatures("serde", "1"),
    service.getFeatures("serde", "^1.0"),
  ]);

  assert.equal(requestCount, 1);
  releaseRequest();

  const [first, second] = await pendingRequests;
  assert.deepEqual(first, ["derive"]);
  assert.deepEqual(second, ["derive"]);
});
