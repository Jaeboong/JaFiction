import * as assert from "node:assert/strict";
import test from "node:test";
import {
  SOURCE_TIERS,
  SourceTierSchema,
  compareTiers,
  isFactual,
  isWeakTier
} from "../core/sourceTier";

test("SOURCE_TIERS 배열이 강함→약함 순서인지", () => {
  assert.deepEqual(SOURCE_TIERS, ["factual", "contextual", "role"]);
});

test("SourceTierSchema.parse 유효한 값 성공", () => {
  assert.equal(SourceTierSchema.parse("factual"), "factual");
  assert.equal(SourceTierSchema.parse("contextual"), "contextual");
  assert.equal(SourceTierSchema.parse("role"), "role");
});

test("SourceTierSchema.parse 유효하지 않은 문자열 실패", () => {
  assert.throws(() => SourceTierSchema.parse("unknown"));
});

test("SourceTierSchema.parse 비문자열 입력 실패", () => {
  assert.throws(() => SourceTierSchema.parse(123));
  assert.throws(() => SourceTierSchema.parse(null));
});

test("isFactual: factual → true, 나머지 → false", () => {
  assert.equal(isFactual("factual"), true);
  assert.equal(isFactual("contextual"), false);
  assert.equal(isFactual("role"), false);
});

test("isWeakTier: role → true, 나머지 → false", () => {
  assert.equal(isWeakTier("role"), true);
  assert.equal(isWeakTier("factual"), false);
  assert.equal(isWeakTier("contextual"), false);
});

test("compareTiers: factual > contextual", () => {
  assert.equal(compareTiers("factual", "contextual"), 1);
});

test("compareTiers: contextual > role", () => {
  assert.equal(compareTiers("contextual", "role"), 1);
});

test("compareTiers: factual > role", () => {
  assert.equal(compareTiers("factual", "role"), 1);
});

test("compareTiers: 동일 tier → 0", () => {
  assert.equal(compareTiers("factual", "factual"), 0);
});

test("compareTiers: role < factual → -1", () => {
  assert.equal(compareTiers("role", "factual"), -1);
});
