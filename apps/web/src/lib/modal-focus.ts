import { useEffect, type RefObject } from "react";

export interface ModalFocusOptions {
  initialFocus?: "control" | "container";
}

export function useModalFocus(
  containerRef: RefObject<HTMLElement | null>,
  active: boolean,
  options: ModalFocusOptions = {}
): void {
  const initialFocus = options.initialFocus ?? "control";
  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (container === null) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const focusable = getFocusable(container);
    if (initialFocus === "container") {
      container.focus({ preventScroll: true });
      container.scrollTop = 0;
    } else {
      const initial = container.querySelector<HTMLElement>("[data-initial-focus]") ?? focusable[0];
      initial?.focus();
    }

    const containFocus = (event: KeyboardEvent): void => {
      if (event.key !== "Tab") return;
      const controls = getFocusable(container);
      const first = controls[0];
      const last = controls.at(-1);
      if (first === undefined || last === undefined) {
        event.preventDefault();
        container.focus({ preventScroll: true });
        return;
      }
      if (document.activeElement === container) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (
        event.shiftKey &&
        (document.activeElement === first || !container.contains(document.activeElement))
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || !container.contains(document.activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", containFocus);
    return () => {
      document.removeEventListener("keydown", containFocus);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [active, containerRef, initialFocus]);
}

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(
    "button:not(:disabled), input:not(:disabled), select:not(:disabled), [href], [tabindex]:not([tabindex='-1'])"
  )).filter((element) => !element.hasAttribute("hidden") && element.getAttribute("aria-hidden") !== "true");
}
