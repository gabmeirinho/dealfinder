import type {
  AcquisitionPauseScope,
  FacebookFailureKind
} from "@dealfinder/domain";

import type { MarketplaceResultSnapshot } from "../../../modules/browser/index.js";

export interface FacebookPageFailure {
  kind: FacebookFailureKind;
  scope: AcquisitionPauseScope;
  detail: string;
}

export interface FacebookFailureContext {
  unchangedSnapshots: number;
}

export function classifyFacebookPage(
  snapshot: MarketplaceResultSnapshot,
  context: FacebookFailureContext
): FacebookPageFailure | null {
  const page = snapshot.page;
  if (page === undefined) return null;
  const url = page.url.toLocaleLowerCase("en");
  const text = `${page.title}\n${page.bodyText}`.toLocaleLowerCase("en");

  if (url.includes("/checkpoint/") || matches(text, ["security checkpoint", "confirma a tua identidade", "checkpoint required"])) {
    return failure("checkpoint", "browser", "Facebook presented an account checkpoint");
  }
  if (
    url.includes("/login") ||
    matches(text, ["log in to facebook", "inicia sessão no facebook", "email or phone", "e-mail ou telemóvel"])
  ) {
    return failure("login_required", "browser", "Facebook requires a manual login");
  }
  if (matches(text, [
    "marketplace isn't available to you",
    "marketplace is not available to you",
    "não podes aceder ao marketplace",
    "marketplace não está disponível"
  ])) {
    return failure("marketplace_restricted", "browser", "Facebook denied Marketplace access");
  }
  if (matches(text, [
    "allow the use of cookies",
    "cookies on facebook",
    "permitir a utilização de cookies",
    "aceitar todos os cookies"
  ])) {
    return failure("consent_required", "browser", "Facebook requires a manual consent choice");
  }
  if (matches(text, [
    "you're temporarily blocked",
    "you are temporarily blocked",
    "too many requests",
    "try again later",
    "temporariamente bloqueado",
    "demasiados pedidos"
  ])) {
    return failure("rate_limited", "source", "Facebook requested that acquisition slow down");
  }
  if (matches(text, [
    "no listings found",
    "there are currently no products",
    "nenhum anúncio encontrado",
    "não há anúncios"
  ])) {
    return failure("empty_results", "search", "Facebook explicitly returned no Marketplace listings");
  }
  if (
    matches(text, ["something went wrong", "error loading", "alguma coisa correu mal", "erro ao carregar"]) ||
    (page.loading && context.unchangedSnapshots >= 2)
  ) {
    return failure("partial_load", "search", "Marketplace results did not finish loading");
  }
  if (
    snapshot.cards.length === 0 &&
    url.includes("/marketplace/") &&
    (snapshot.atEnd || context.unchangedSnapshots >= 2)
  ) {
    return selectorContractFailure();
  }
  return null;
}

export function selectorContractFailure(): FacebookPageFailure {
  return failure(
    "selector_contract",
    "source",
    "Facebook Marketplace no longer matches the reviewed result-card contract"
  );
}

function failure(
  kind: FacebookFailureKind,
  scope: AcquisitionPauseScope,
  detail: string
): FacebookPageFailure {
  return { kind, scope, detail };
}

function matches(value: string, needles: readonly string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}
