export interface BrowserSession {
  readonly controlledTabs: 1;
  navigate(url: string): Promise<string>;
  currentUrl(): string;
  close(): Promise<void>;
  onClosed(listener: () => void): () => void;
}

export interface BrowserAdapter {
  open(profileDirectory: string): Promise<BrowserSession>;
}
