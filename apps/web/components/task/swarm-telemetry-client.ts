/**
 * KanDev Swarm Cockpit Telemetry Client
 * 
 * Production-ready SSE client connecting to kandev-operator-telemetry:8082
 * Supporting real-time tool calls, workflow events, flaky-test quarantine,
 * and mid-turn human-in-the-loop steering.
 */

export interface ToolCallEvent {
  workflow_name: string;
  turn: number;
  role: string;
  tool_name: string;
  arguments?: string;
  arguments_snippet?: string;
  result_status: 'success' | 'error' | 'blocked';
  duration_ms: number;
  timestamp: string;
}

export interface WorkflowEvent {
  workflow_name: string;
  turn: number;
  role: string;
  event_type: string;
  verdict?: string;
  open_findings_count?: number;
  message?: string;
  timestamp: string;
  pull_request?: {
    number: number;
    url: string;
    status: string;
  };
}

export interface TestQuarantinedEvent {
  workflow_name: string;
  turn: number;
  role: string;
  test_name: string;
  failure_log?: string;
  reason: string;
  diff_isolated: boolean;
  quarantine_path?: string;
  timestamp: string;
}

export type ConnectionState = 'connecting' | 'connected' | 'offline';

export interface SwarmClientOptions {
  baseUrl?: string; // default: window.location.origin or http://localhost:8082
  workflowName?: string; // default: "*" (all workflows)
  onToolCall?: (event: ToolCallEvent) => void;
  onWorkflowEvent?: (type: string, event: WorkflowEvent) => void;
  onQuarantinedTest?: (event: TestQuarantinedEvent) => void;
  onConnectionChange?: (state: ConnectionState) => void;
  autoReconnect?: boolean;
}

export class SwarmTelemetryClient {
  private baseUrl: string;
  private workflow: string;
  private eventSource: EventSource | null = null;
  private options: SwarmClientOptions;
  private reconnectTimeout: any = null;
  private isManuallyClosed = false;

  constructor(options: SwarmClientOptions = {}) {
    this.options = options;
    this.baseUrl = (options.baseUrl || '').replace(/\/$/, '');
    this.workflow = options.workflowName || '*';
  }

  public connect(): void {
    this.isManuallyClosed = false;
    if (this.eventSource) {
      this.eventSource.close();
    }

    this.options.onConnectionChange?.('connecting');

    const streamPath = this.workflow === '*' 
      ? '/api/v1/telemetry/events' 
      : `/api/v1/workflows/${encodeURIComponent(this.workflow)}/stream`;

    const streamUrl = `${this.baseUrl}${streamPath}`;
    this.eventSource = new EventSource(streamUrl);

    this.eventSource.onopen = () => {
      this.options.onConnectionChange?.('connected');
    };

    this.eventSource.onerror = (err) => {
      this.options.onConnectionChange?.('offline');
      if (!this.isManuallyClosed && this.options.autoReconnect !== false) {
        if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
        this.reconnectTimeout = setTimeout(() => {
          this.connect();
        }, 3000);
      }
    };

    // Specific typed event listeners
    this.eventSource.addEventListener('tool_call', (e) => {
      try {
        const payload: ToolCallEvent = JSON.parse(e.data);
        this.options.onToolCall?.(payload);
      } catch (err) {
        console.error('Failed to parse tool_call event:', err);
      }
    });

    this.eventSource.addEventListener('quarantined_test', (e) => {
      try {
        const payload: TestQuarantinedEvent = JSON.parse(e.data);
        this.options.onQuarantinedTest?.(payload);
      } catch (err) {
        console.error('Failed to parse quarantined_test event:', err);
      }
    });

    const standardEventTypes = [
      'turn_started', 'turn_completed', 'review_approved', 'review_rejected', 
      'operator_steer', 'operator_abort', 'fix_committed'
    ];

    standardEventTypes.forEach((type) => {
      this.eventSource?.addEventListener(type, (e) => {
        try {
          const payload: WorkflowEvent = JSON.parse(e.data);
          this.options.onWorkflowEvent?.(type, payload);
        } catch (err) {
          console.error(`Failed to parse ${type} event:`, err);
        }
      });
    });

    // Catch-all message handler
    this.eventSource.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.tool_name && data.result_status) {
          this.options.onToolCall?.(data as ToolCallEvent);
        } else if (data.test_name && data.reason) {
          this.options.onQuarantinedTest?.(data as TestQuarantinedEvent);
        } else if (data.event_type) {
          this.options.onWorkflowEvent?.(data.event_type, data as WorkflowEvent);
        }
      } catch (err) {
        // Heartbeat pings or raw text frames ignored
      }
    };
  }

  public disconnect(): void {
    this.isManuallyClosed = true;
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    this.options.onConnectionChange?.('offline');
  }

  public async steer(role: string, message: string): Promise<{ success: boolean; error?: string }> {
    if (this.workflow === '*' || !this.workflow) {
      return { success: false, error: 'Cannot steer wildcard workflow. Specify target workflow name.' };
    }
    try {
      const resp = await fetch(`${this.baseUrl}/api/v1/workflows/${encodeURIComponent(this.workflow)}/steer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, message }),
      });
      if (!resp.ok) {
        return { success: false, error: await resp.text() };
      }
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  public async abort(reason?: string): Promise<{ success: boolean; error?: string }> {
    if (this.workflow === '*' || !this.workflow) {
      return { success: false, error: 'Cannot abort wildcard workflow. Specify target workflow name.' };
    }
    try {
      const resp = await fetch(`${this.baseUrl}/api/v1/workflows/${encodeURIComponent(this.workflow)}/abort`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason || 'Aborted via Cockpit UI' }),
      });
      if (!resp.ok) {
        return { success: false, error: await resp.text() };
      }
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }
}
