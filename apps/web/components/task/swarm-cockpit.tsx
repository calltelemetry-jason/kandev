import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  SwarmTelemetryClient, 
  ToolCallEvent, 
  WorkflowEvent, 
  TestQuarantinedEvent, 
  ConnectionState 
} from './swarm-telemetry-client';

export interface SwarmCockpitProps {
  workflowName: string;
  telemetryUrl?: string; // e.g. "http://localhost:8082" or in-cluster "/api/v1/telemetry"
  className?: string;
}

export interface PersonaNodeState {
  role: string;
  status: 'idle' | 'active' | 'approved' | 'rejected';
  duration?: string;
  tokens?: number;
  pullRequest?: { number: number; url: string };
}

export function useSwarmTelemetry(workflowName: string, telemetryUrl?: string) {
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const [toolCalls, setToolCalls] = useState<ToolCallEvent[]>([]);
  const [events, setEvents] = useState<WorkflowEvent[]>([]);
  const [quarantinedTests, setQuarantinedTests] = useState<TestQuarantinedEvent[]>([]);
  const [nodes, setNodes] = useState<Record<string, PersonaNodeState>>({
    coordinator: { role: 'coordinator', status: 'idle' },
    coder: { role: 'coder', status: 'idle' },
    tester: { role: 'tester', status: 'idle' },
    reviewer: { role: 'reviewer', status: 'idle' },
  });

  const clientRef = useRef<SwarmTelemetryClient | null>(null);

  useEffect(() => {
    const client = new SwarmTelemetryClient({
      baseUrl: telemetryUrl,
      workflowName,
      onConnectionChange: setConnectionState,
      onToolCall: (tc) => {
        setToolCalls((prev) => [tc, ...prev].slice(0, 100));
        // Check for quarantine tool call
        if (tc.tool_name === 'quarantine_flaky_test') {
          try {
            const args = JSON.parse(tc.arguments || tc.arguments_snippet || '{}');
            if (args.test_name) {
              setQuarantinedTests((prev) => {
                if (prev.some((q) => q.test_name === args.test_name)) return prev;
                return [{
                  workflow_name: tc.workflow_name,
                  turn: tc.turn,
                  role: tc.role,
                  test_name: args.test_name,
                  reason: args.reason || 'Isolated during bisection',
                  diff_isolated: true,
                  timestamp: tc.timestamp,
                }, ...prev];
              });
            }
          } catch (e) {}
        }
      },
      onWorkflowEvent: (type, evt) => {
        setEvents((prev) => [evt, ...prev].slice(0, 50));
        if (evt.role) {
          const roleLower = evt.role.toLowerCase();
          setNodes((prev) => {
            const current = prev[roleLower] || { role: roleLower, status: 'idle' };
            let status: PersonaNodeState['status'] = 'active';
            if (evt.verdict === 'APPROVED') status = 'approved';
            if (evt.verdict === 'REJECTED') status = 'rejected';
            return {
              ...prev,
              [roleLower]: {
                ...current,
                status,
                pullRequest: evt.pull_request,
              },
            };
          });
        }
      },
      onQuarantinedTest: (q) => {
        setQuarantinedTests((prev) => {
          if (prev.some((x) => x.test_name === q.test_name)) return prev;
          return [q, ...prev];
        });
      },
    });

    client.connect();
    clientRef.current = client;

    return () => {
      client.disconnect();
    };
  }, [workflowName, telemetryUrl]);

  const steer = useCallback(async (role: string, message: string) => {
    if (!clientRef.current) return { success: false, error: 'Client not initialized' };
    return clientRef.current.steer(role, message);
  }, []);

  const abort = useCallback(async (reason?: string) => {
    if (!clientRef.current) return { success: false, error: 'Client not initialized' };
    return clientRef.current.abort(reason);
  }, []);

  return { connectionState, toolCalls, events, quarantinedTests, nodes, steer, abort };
}

export const SwarmCockpit: React.FC<SwarmCockpitProps> = ({ workflowName, telemetryUrl, className = '' }) => {
  const { connectionState, toolCalls, quarantinedTests, nodes, steer, abort } = useSwarmTelemetry(workflowName, telemetryUrl);
  const [steerRole, setSteerRole] = useState('coder');
  const [steerMessage, setSteerMessage] = useState('');
  const [steerStatus, setSteerStatus] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSteer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!steerMessage.trim()) return;
    setIsSubmitting(true);
    setSteerStatus('Delivering steering...');
    const res = await steer(steerRole, steerMessage);
    setIsSubmitting(false);
    if (res.success) {
      setSteerStatus(`Delivered steering to ${steerRole}!`);
      setSteerMessage('');
      setTimeout(() => setSteerStatus(''), 4000);
    } else {
      setSteerStatus(`Failed: ${res.error}`);
    }
  };

  const handleAbort = async () => {
    if (!window.confirm(`Are you sure you want to ABORT workflow "${workflowName}"?`)) return;
    const res = await abort('Aborted via React Cockpit');
    if (res.success) {
      alert(`Abort signal delivered to ${workflowName}.`);
    } else {
      alert(`Abort failed: ${res.error}`);
    }
  };

  return (
    <div className={`bg-[#090d16] text-slate-100 p-6 rounded-2xl border border-slate-800 font-sans space-y-6 ${className}`}>
      {/* Cockpit Header */}
      <div className="flex items-center justify-between border-b border-slate-800/80 pb-4">
        <div className="flex items-center space-x-3">
          <div className="h-8 w-8 rounded-lg bg-blue-600/20 border border-blue-500/40 flex items-center justify-center text-blue-400 font-black">⚡</div>
          <div>
            <h2 className="text-base font-bold tracking-tight text-white flex items-center gap-2">
              KanDev Swarm Cockpit
              <span className="text-xs font-mono px-2 py-0.5 rounded bg-blue-950 text-blue-400 border border-blue-800/60">
                {workflowName}
              </span>
            </h2>
            <p className="text-xs text-slate-400">Real-time parallel persona telemetry & mid-loop steering</p>
          </div>
        </div>
        <div className="flex items-center space-x-2 px-3 py-1.5 rounded-full text-xs font-medium border bg-slate-900">
          <span className={`h-2 w-2 rounded-full ${
            connectionState === 'connected' ? 'bg-emerald-400 animate-pulse' : connectionState === 'connecting' ? 'bg-amber-400' : 'bg-rose-400'
          }`} />
          <span className="font-mono capitalize">{connectionState}</span>
        </div>
      </div>

      {/* Persona Swarm Nodes Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {Object.entries(nodes).map(([role, node]) => {
          const isApproved = node.status === 'approved';
          const isRejected = node.status === 'rejected';
          const isActive = node.status === 'active';
          return (
            <div key={role} className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 transition-all">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-300 capitalize">{role}</span>
                <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                  isApproved ? 'bg-emerald-950 text-emerald-300 border-emerald-800' :
                  isRejected ? 'bg-rose-950 text-rose-300 border-rose-800' :
                  isActive ? 'bg-blue-950 text-blue-300 border-blue-800' :
                  'bg-slate-800 text-slate-400 border-slate-700'
                }`}>
                  {node.status}
                </span>
              </div>
              {role === 'coder' || role === 'tester' ? (
                <span className="inline-block text-[10px] font-mono px-1.5 py-0.2 rounded bg-cyan-950 text-cyan-300 border border-cyan-800 mb-2">
                  Parallel Stage (dev-team)
                </span>
              ) : null}
              {node.pullRequest ? (
                <a href={node.pullRequest.url} target="_blank" rel="noreferrer" className="text-xs text-blue-400 hover:underline block truncate mt-1">
                  Draft PR #{node.pullRequest.number}
                </a>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* Flaky-Test Quarantine Banner (if any) */}
      {quarantinedTests.length > 0 && (
        <div className="bg-amber-950/20 border border-amber-900/60 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
              <span>🛡️ Automated Flaky-Test Quarantine</span>
              <span className="px-2 py-0.5 rounded bg-amber-900/60 text-amber-200 text-[10px]">{quarantinedTests.length} Isolated</span>
            </h3>
            <span className="text-[10px] text-amber-300/80">Diff-isolated via NATS peer query</span>
          </div>
          <div className="space-y-1 text-xs font-mono text-slate-300">
            {quarantinedTests.map((q, idx) => (
              <div key={idx} className="flex items-center justify-between py-1 border-b border-amber-900/20">
                <span className="font-semibold text-amber-200">{q.test_name}</span>
                <span className="text-slate-400 truncate max-w-xs">{q.reason}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800">ISO</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Split Stream: Tool Invocations & Steering Form */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Live Tool-Call Stream */}
        <div className="lg:col-span-2 bg-slate-900/90 border border-slate-800 rounded-xl p-4">
          <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-3">Live Tool Telemetry ({toolCalls.length})</h3>
          <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
            {toolCalls.length === 0 ? (
              <div className="text-center py-10 text-slate-500 text-xs font-mono">Waiting for tool invocations...</div>
            ) : (
              toolCalls.map((tc, idx) => (
                <div key={idx} className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-blue-400 font-bold">{tc.role} <span className="text-slate-500 font-normal">→</span> {tc.tool_name}</span>
                    <span className="text-[10px] text-slate-500">{tc.duration_ms}ms</span>
                  </div>
                  {tc.arguments_snippet && (
                    <div className="text-[11px] text-slate-400 truncate bg-slate-900 px-2 py-0.5 rounded">{tc.arguments_snippet}</div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right 1 Col: Mid-Loop Steering Form */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 space-y-4">
          <div>
            <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-1">🎮 Mid-Loop Steering</h3>
            <p className="text-[11px] text-slate-400">Inject prompts directly into active persona loop</p>
          </div>
          <form onSubmit={handleSteer} className="space-y-3">
            <div>
              <label className="block text-[11px] font-mono text-slate-400 mb-1">Target Persona</label>
              <select value={steerRole} onChange={(e) => setSteerRole(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-lg text-xs font-mono text-white p-2">
                <option value="coder">Coder</option>
                <option value="tester">Tester</option>
                <option value="reviewer">Reviewer</option>
                <option value="all">All (Broadcast)</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-mono text-slate-400 mb-1">Guidance Instruction</label>
              <textarea rows={3} required value={steerMessage} onChange={(e) => setSteerMessage(e.target.value)} placeholder="e.g. Focus on edge cases..." className="w-full bg-slate-950 border border-slate-700 rounded-lg text-xs font-mono text-white p-2" />
            </div>
            <button type="submit" disabled={isSubmitting} className="w-full bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs py-2 px-4 rounded-lg transition">
              {isSubmitting ? 'Delivering...' : 'Send Guidance'}
            </button>
            {steerStatus && <p className="text-[11px] font-mono text-center text-slate-300">{steerStatus}</p>}
          </form>

          <hr className="border-slate-800" />

          <button onClick={handleAbort} className="w-full bg-rose-950/60 hover:bg-rose-900 border border-rose-800 text-rose-300 text-xs py-2 px-4 rounded-lg font-medium transition">
            Abort Workflow
          </button>
        </div>
      </div>
    </div>
  );
};
