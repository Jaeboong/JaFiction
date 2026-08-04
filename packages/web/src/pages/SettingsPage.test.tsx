import { describe, it } from "vitest";
import { strict as assert } from "node:assert";
import { renderToStaticMarkup } from "react-dom/server";
import type { SidebarState } from "@jasojeon/shared";
import { SettingsPage } from "./SettingsPage";

const state: SidebarState = {
  workspaceOpened: true,
  extensionVersion: "test",
  openDartConfigured: false,
  openDartConnectionStatus: "untested",
  providers: [],
  profileDocuments: [],
  projects: [],
  preferences: { serverSyncEnabled: false },
  agentDefaults: {},
  runState: { status: "idle" },
  defaultRubric: ""
};

const noop = () => undefined;
const noopAsync = async () => undefined;

describe("SettingsPage server sync section", () => {
  it("renders the opt-in section as disconnected with sync disabled", () => {
    const html = renderToStaticMarkup(
      <SettingsPage
        state={state}
        selectedSection="server-sync"
        storageRoot=""
        runnerBaseUrlDraft="http://runner.test"
        onSelectSection={noop}
        onRunnerBaseUrlDraftChange={noop}
        onApplyRunnerBaseUrl={noop}
        onSaveAgentDefaults={noopAsync}
        onSaveServerSyncEnabled={noopAsync}
        onSyncNow={async () => ({
          syncedDocuments: 0,
          syncedProjects: 0,
          lastSyncedAt: "2026-05-27T00:00:00.000Z"
        })}
        onSyncDisable={noopAsync}
      />
    );

    assert.match(html, /aria-label="서버 연동"/);
    assert.match(html, /미연동/);
    assert.match(html, /data-testid="server-sync-toggle"/);
    assert.match(html, /지금 동기화/);
    assert.match(html, /disabled=""/);
  });

  it("renders last synced time when sync is enabled", () => {
    const enabledState: SidebarState = {
      ...state,
      preferences: {
        serverSyncEnabled: true,
        lastSyncedAt: "2026-05-27T00:00:00.000Z"
      }
    };

    const html = renderToStaticMarkup(
      <SettingsPage
        state={enabledState}
        selectedSection="server-sync"
        storageRoot=""
        runnerBaseUrlDraft="http://runner.test"
        onSelectSection={noop}
        onRunnerBaseUrlDraftChange={noop}
        onApplyRunnerBaseUrl={noop}
        onSaveAgentDefaults={noopAsync}
        onSaveServerSyncEnabled={noopAsync}
        onSyncNow={async () => ({
          syncedDocuments: 2,
          syncedProjects: 3,
          lastSyncedAt: "2026-05-27T00:00:00.000Z"
        })}
        onSyncDisable={noopAsync}
      />
    );

    assert.match(html, /연동됨/);
    assert.match(html, /마지막 동기화/);
    assert.match(html, /2026/);
  });
});
