import type { AgentDefaults, EssayRoleId, ProviderId, ProviderRuntimeState } from "@jasojeon/shared";
import { useEffect, useMemo, useState } from "react";
import { essayRoleIds, essayRoleLabels, materializeAgentDefaults } from "../agentDefaults";
import { providerName } from "../formatters";

interface AgentEffortSectionProps {
  providers: ProviderRuntimeState[];
  agentDefaults: AgentDefaults;
  onSave(agentDefaults: AgentDefaults): Promise<void>;
}

interface AgentDefaultDraftEntry {
  providerId: ProviderId;
  useProviderDefaults: boolean;
  modelOverride: string;
  effortOverride: string;
}

type AgentDefaultsDraft = Record<EssayRoleId, AgentDefaultDraftEntry>;

export function AgentEffortSection({ providers, agentDefaults, onSave }: AgentEffortSectionProps) {
  const [draft, setDraft] = useState<AgentDefaultsDraft>(() => buildDraft(providers, agentDefaults));
  const [isSaving, setIsSaving] = useState(false);
  const providersById = useMemo(
    () => new Map(providers.map((provider) => [provider.providerId, provider])),
    [providers]
  );

  useEffect(() => {
    setDraft(buildDraft(providers, agentDefaults));
  }, [providers, agentDefaults]);

  const nextPayload = buildPayload(draft);
  const hasChanges = serializeAgentDefaults(nextPayload) !== serializeAgentDefaults(agentDefaults);

  return (
    <section className="overview-roles-section">
      <div className="overview-section-header overview-section-header--with-action">
        <h2 className="overview-section-title">에이전트 역할 배정</h2>
        <button
          className="overview-save-button"
          disabled={!providers.length || !hasChanges || isSaving}
          onClick={async () => {
            setIsSaving(true);
            try {
              await onSave(nextPayload);
            } finally {
              setIsSaving(false);
            }
          }}
        >
          {isSaving ? <ButtonBusyLabel label="저장중..." /> : "저장"}
        </button>
      </div>

      {!providers.length ? (
        <div className="overview-empty-state">
          프로바이더를 먼저 연결하면 역할 배정을 저장할 수 있습니다.
        </div>
      ) : (
        <div className="overview-role-table-wrap">
          <table className="overview-role-table">
            <thead>
              <tr>
                <th className="overview-role-col-role">역할</th>
                <th className="overview-role-col-provider">프로바이더</th>
                <th>모델 오버라이드</th>
                <th className="overview-role-col-effort">Effort</th>
                <th className="overview-role-col-defaults">기본값 사용</th>
              </tr>
            </thead>
            <tbody>
              {essayRoleIds.map((roleId) => {
                const entry = draft[roleId];
                const provider = providersById.get(entry.providerId) ?? providers[0];
                const modelOverride = entry.useProviderDefaults ? "—" : entry.modelOverride.trim() || "—";
                const effortOverride = entry.useProviderDefaults ? "—" : entry.effortOverride.trim() || "—";
                const effortTone = effortToneForValue(effortOverride);

                return (
                  <tr key={roleId} title={provider ? providerName(provider.providerId) : undefined}>
                    <td className="overview-role-name">{essayRoleLabels[roleId]}</td>
                    <td className="overview-role-provider">
                      <select
                        value={provider?.providerId ?? providers[0].providerId}
                        onChange={(event) => {
                          const nextProviderId = event.target.value as ProviderId;
                          const nextProvider = providersById.get(nextProviderId) ?? providers[0];
                          setDraft((current) => ({
                            ...current,
                            [roleId]: {
                              ...current[roleId],
                              providerId: nextProviderId,
                              modelOverride: "",
                              effortOverride: nextProvider.capabilities.supportsEffort
                                ? current[roleId].effortOverride
                                : ""
                            }
                          }));
                        }}
                      >
                        {providers.map((item) => (
                          <option key={item.providerId} value={item.providerId}>
                            {providerName(item.providerId)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className={`overview-role-override ${modelOverride !== "—" ? "is-value" : ""}`}>
                      {provider?.capabilities.modelOptions.length ? (
                        <select
                          value={entry.modelOverride}
                          disabled={entry.useProviderDefaults}
                          onChange={(event) => {
                            const nextValue = event.target.value;
                            setDraft((current) => ({
                              ...current,
                              [roleId]: {
                                ...current[roleId],
                                modelOverride: nextValue
                              }
                            }));
                          }}
                        >
                          {provider.capabilities.modelOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          value={entry.modelOverride}
                          disabled={entry.useProviderDefaults}
                          onChange={(event) => {
                            const nextValue = event.target.value;
                            setDraft((current) => ({
                              ...current,
                              [roleId]: {
                                ...current[roleId],
                                modelOverride: nextValue
                              }
                            }));
                          }}
                          placeholder="기본값"
                        />
                      )}
                    </td>
                    <td>
                      {provider?.capabilities.supportsEffort ? (
                        <select
                          value={entry.effortOverride}
                          disabled={entry.useProviderDefaults}
                          onChange={(event) => {
                            const nextValue = event.target.value;
                            setDraft((current) => ({
                              ...current,
                              [roleId]: {
                                ...current[roleId],
                                effortOverride: nextValue
                              }
                            }));
                          }}
                        >
                          {provider.capabilities.effortOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      ) : effortOverride === "—" ? (
                        <span className="overview-role-placeholder">—</span>
                      ) : (
                        <span className={`overview-role-chip tone-${effortTone}`}>{effortOverride}</span>
                      )}
                    </td>
                    <td className="overview-role-checkbox-cell">
                      <input
                        aria-label={`${essayRoleLabels[roleId]} 기본값 사용`}
                        type="checkbox"
                        checked={entry.useProviderDefaults}
                        onChange={(event) => {
                          const useProviderDefaults = event.target.checked;
                          setDraft((current) => ({
                            ...current,
                            [roleId]: {
                              ...current[roleId],
                              useProviderDefaults,
                              modelOverride: useProviderDefaults ? "" : current[roleId].modelOverride,
                              effortOverride: useProviderDefaults ? "" : current[roleId].effortOverride
                            }
                          }));
                        }}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function buildDraft(providers: ProviderRuntimeState[], agentDefaults: AgentDefaults): AgentDefaultsDraft {
  return materializeAgentDefaults(agentDefaults, providers);
}

function buildPayload(draft: AgentDefaultsDraft): AgentDefaults {
  return essayRoleIds.reduce<AgentDefaults>((accumulator, roleId) => {
    const entry = draft[roleId];
    accumulator[roleId] = {
      providerId: entry.providerId,
      useProviderDefaults: entry.useProviderDefaults,
      modelOverride: entry.useProviderDefaults ? "" : entry.modelOverride.trim(),
      effortOverride: entry.useProviderDefaults ? "" : entry.effortOverride.trim()
    };
    return accumulator;
  }, {});
}

function serializeAgentDefaults(agentDefaults: AgentDefaults): string {
  return JSON.stringify(
    essayRoleIds.flatMap((roleId) => {
      const config = agentDefaults[roleId];
      if (!config) {
        return [];
      }

      return [[roleId, config]];
    })
  );
}

function effortToneForValue(value: string): "positive" | "warning" | "neutral" {
  const normalized = value.trim().toLowerCase();
  if (normalized === "high") {
    return "warning";
  }
  if (normalized === "low") {
    return "positive";
  }
  return "neutral";
}

function ButtonBusyLabel({ label }: { label: string }) {
  return (
    <span className="button-busy-label">
      <span className="activity-indicator" aria-hidden="true" />
      {label}
    </span>
  );
}
