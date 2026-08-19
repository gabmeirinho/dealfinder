export interface BrowserSession {
  readonly controlledTabs: 1;
  close(): Promise<void>;
  onClosed(listener: () => void): () => void;
}

export interface BrowserAdapter {
  open(profileDirectory: string): Promise<BrowserSession>;
}
