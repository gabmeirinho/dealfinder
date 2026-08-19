export const BROWSER_ATTENTION_REASONS = [
  "browser_closed",
  "login_required",
  "marketplace_denied",
  "checkpoint",
  "launch_failed"
] as const;

export type BrowserAttentionReason = typeof BROWSER_ATTENTION_REASONS[number];

export type BrowserRuntimeState =
  | "stopped"
  | "opening"
  | "open"
  | "stopping"
  | "paused";

export interface BrowserStatus {
  state: BrowserRuntimeState;
  attentionReason: BrowserAttentionReason | null;
  attentionDetail: string | null;
  changedAt: string;
  profilePersistent: true;
  controlledTabs: 0 | 1;
}

export interface BrowserControls {
  canOpen: boolean;
  canStop: boolean;
  canResume: boolean;
}

export function browserControlsFor(status: BrowserStatus): BrowserControls {
  return {
    canOpen: status.state === "stopped",
    canStop: status.state === "open",
    canResume: status.state === "paused"
  };
}
