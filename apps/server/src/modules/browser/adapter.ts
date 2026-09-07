import { canonicalStandvirtualDetailUrl } from "../../sources/standvirtual/detail-parser.js";

export interface BrowserSession {
  readonly controlledTabs: 1;
  navigate(url: string): Promise<string>;
  /** Open a source-validated Facebook or Standvirtual listing in the controlled tab. */
  navigateListing?(url: string): Promise<string>;
  currentUrl(): string;
  close(): Promise<void>;
  onClosed(listener: () => void): () => void;
  snapshotMarketplaceResults?(): Promise<MarketplaceResultSnapshot>;
  snapshotListingDetail?(): Promise<MarketplacePageEvidence>;
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

export function validateListingNavigationUrl(input: string): string {
  const url = new URL(input);
  if (url.hostname === "www.standvirtual.com") return canonicalStandvirtualDetailUrl(input);
  if (url.protocol === "https:" && !url.username && !url.password && !url.port &&
      (url.hostname === "facebook.com" || url.hostname.endsWith(".facebook.com")) &&
      /^\/marketplace\/(?:shops\/|np\/)?item\/\d+\/?$/u.test(url.pathname)) return url.href;
  throw new Error("Listing URL must be a secure Facebook Marketplace or Standvirtual vehicle URL.");
}
