import * as assert from "node:assert/strict";
import test from "node:test";
import { buildRoleAssignmentsFromDefaults } from "../core/roleAssignments";

test("buildRoleAssignmentsFromDefaults only includes configured roles and normalizes overrides", () => {
  const roleAssignments = buildRoleAssignmentsFromDefaults({
    context_researcher: {
      providerId: "claude",
      useProviderDefaults: false,
      modelOverride: " claude-3.7-sonnet ",
      effortOverride: " high "
    },
    finalizer: {
      providerId: "codex",
      useProviderDefaults: true,
      modelOverride: "gpt-5.4",
      effortOverride: "medium"
    }
  });

  assert.deepEqual(roleAssignments, [
    {
      role: "context_researcher",
      providerId: "claude",
      useProviderDefaults: false,
      modelOverride: "claude-3.7-sonnet",
      effortOverride: "high"
    },
    {
      role: "finalizer",
      providerId: "codex",
      useProviderDefaults: true,
      modelOverride: undefined,
      effortOverride: undefined
    }
  ]);
});
