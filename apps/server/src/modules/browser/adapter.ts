export interface BrowserSession {
  readonly controlledTabs: 1;
  navigate(url: string): Promise<string>;
  currentUrl(): string;
  close(): Promise<void>;
  onClosed(listener: () => void): () => void;
  snapshotMarketplaceResults?(): Promise<MarketplaceResultSnapshot>;
  scrollMarketplaceResults?(): Promise<void>;
  captureDiagnosticScreenshot?(): Promise<Uint8Array>;
}

export interface MarketplaceResultSnapshot {
  cards: readonly string[];
  atEnd: boolean;
  page?: MarketplacePageEvidence;
}

export interface MarketplacePageEvidence {
  url: string;
  title: string;
  bodyText: string;
  html: string;
  loading: boolean;
}

export interface BrowserAdapter {
  open(profileDirectory: string): Promise<BrowserSession>;
}
