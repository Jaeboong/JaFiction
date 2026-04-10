import type { AgentDefaults, ProviderId, ProviderRuntimeState } from "@jafiction/shared";
import { essayRoleIds, essayRoleLabels, materializeAgentDefaults } from "../agentDefaults";
import { providerName } from "../formatters";

interface AgentDefaultsSummaryProps {
  providers: ProviderRuntimeState[];
  agentDefaults: AgentDefaults;
  selectedProviderId?: ProviderId;
}

export function AgentDefaultsSummary({
  providers,
  agentDefaults,
  selectedProviderId
}: AgentDefaultsSummaryProps) {
  const resolvedDefaults = materializeAgentDefaults(agentDefaults, providers);
  const roleIds = essayRoleIds.filter((roleId) => (
    selectedProviderId ? resolvedDefaults[roleId].providerId === selectedProviderId : true
  ));

  return (
    <section className="providers-role-summary-section">
      <div className="providers-section-header">
        <h2>배정된 역할 요약</h2>
      </div>

      <div className="providers-table-shell">
        <table className="providers-role-summary-table">
          <thead>
            <tr>
              <th>역할</th>
              <th className="providers-role-summary-status-col">상태</th>
            </tr>
          </thead>
          <tbody>
            {roleIds.length ? roleIds.map((roleId) => {
              const providerId = resolvedDefaults[roleId].providerId;
              return (
                <tr key={roleId} title={providerTitle(providerId)}>
                  <td>{essayRoleLabels[roleId]}</td>
                  <td>
                    <span className="providers-role-summary-chip">Active</span>
                  </td>
                </tr>
              );
            }) : (
              <tr>
                <td colSpan={2}>이 프로바이더에 직접 배정된 역할이 없습니다.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function providerTitle(providerId: ProviderId): string {
  return providerName(providerId);
}
