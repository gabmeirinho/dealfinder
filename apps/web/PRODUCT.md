# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Inferred from the repository: one local operator in the Lisbon area who is configuring vehicle searches and reviewing potential deals from a desktop browser.

## Product Purpose

Dealfinder is a private, local-first workspace for defining independent vehicle searches, collecting marketplace candidates, and deciding which deals are worth pursuing. Success means the operator can configure searches, understand system state, and preserve their review workflow across restarts without managing source URLs or exposing the dashboard remotely.

## Positioning

Dealfinder keeps one source-neutral search definition and local workflow while source adapters collect from multiple marketplaces. The operator controls the criteria and verification boundary; the system does not auto-contact sellers.

## Operating Context

The application runs manually on the operator's machine, uses Europe/Lisbon time, stores structured data in local SQLite, and is accessed through a loopback-only English dashboard. Search setup covers Lisbon-radius and nationwide modes, followed later by visible-browser verification and sequential scanning.

## Capabilities and Constraints

- Manage up to ten active searches by default, with an explicit confirmation to exceed the soft limit.
- Express vehicle criteria and hard or soft constraints in EUR, kilometres, and horsepower.
- Keep source URLs, credentials, browser sessions, seller contact details, and secret material out of saved-search definitions.
- Preserve state across reloads and process restarts.
- Version one remains local-only, visible-browser, and manually started; Docker, remote access, headless automation, and seller messaging are outside scope.

## Evidence on Hand

No customer claims, marketplace results, vehicle imagery, testimonials, or performance evidence are available and none should be fabricated.

## Product Principles

- Make consequential state and confirmation explicit.
- Keep source-specific complexity behind one canonical operator-owned model.
- Prefer honest placeholders and blocked states over invented readiness.
- Keep private data local and exclude secrets by construction.
- Make recovery actions concrete when local services are unavailable.

## Accessibility & Inclusion

The dashboard uses visible labels, keyboard-operable controls, visible focus, responsive layouts, and reduced-motion support. Search-management workflows must expose field errors to assistive technology.
