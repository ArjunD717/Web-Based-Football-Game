// packages/client/src/ui/menu.ts
// Console-menu selection, gamepad focus travel and the room-code mirror.
// Gameplay input is handled by DesktopControls; this module only runs while the
// lobby is visible and never sends input to the simulation.

type GamepadSnapshot = {
  readonly up: boolean;
  readonly down: boolean;
  readonly left: boolean;
  readonly right: boolean;
  readonly accept: boolean;
  readonly back: boolean;
};

const GAMEPAD_POLL_MS = 55;
const GAMEPAD_REPEAT_MS = 170;
const STICK_THRESHOLD = 0.55;

export function installConsoleMenu(): void {
  const menuRoot = document.getElementById("main-menu");
  const entryView = document.getElementById("entry-view");
  const context = document.querySelector<HTMLElement>(".ui-context");
  if (menuRoot === null || entryView === null || context === null) {
    return;
  }

  const items = Array.from(
    menuRoot.querySelectorAll<HTMLButtonElement>("[data-menu-key]"),
  );
  if (items.length === 0) {
    return;
  }

  const setActive = (key: string): void => {
    for (const item of items) {
      const selected = item.dataset.menuKey === key;
      item.setAttribute("aria-current", String(selected));
    }
    for (const panel of context.querySelectorAll<HTMLElement>(
      "[data-menu-panel]",
    )) {
      const selected = panel.dataset.menuPanel === key;
      panel.hidden = !selected;
      panel.setAttribute("aria-hidden", String(!selected));
    }
  };

  for (const item of items) {
    item.addEventListener("click", () => {
      setActive(item.dataset.menuKey ?? "");
      if (window.matchMedia("(max-width: 820px)").matches) {
        context.scrollIntoView({
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
            .matches
            ? "auto"
            : "smooth",
          block: "start",
        });
      }
    });
    item.addEventListener("focus", () => {
      setActive(item.dataset.menuKey ?? "");
    });
    item.addEventListener("keydown", (event) => {
      const index = items.indexOf(item);
      if (event.key === "ArrowDown" || event.key === "ArrowRight") {
        event.preventDefault();
        items[(index + 1) % items.length]?.focus();
      } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
        event.preventDefault();
        items[(index - 1 + items.length) % items.length]?.focus();
      } else if (event.key === "Home") {
        event.preventDefault();
        items[0]?.focus();
      } else if (event.key === "End") {
        event.preventDefault();
        items[items.length - 1]?.focus();
      }
    });
  }

  const initial =
    items.find((item) => item.getAttribute("aria-current") === "true") ??
    items[0]!;
  setActive(initial.dataset.menuKey ?? "");

  // Settings reuses the existing bindings dialog rather than growing a second
  // key editor. The trigger lives in the Controls dossier.
  for (const trigger of context.querySelectorAll<HTMLElement>(
    "[data-open-controls]",
  )) {
    trigger.addEventListener("click", () => {
      document.getElementById("open-bindings")?.click();
    });
  }

  bindRoomCodeMirror();

  document.addEventListener("keydown", (event) => {
    if (
      entryView.hidden ||
      document.querySelector("dialog[open]") !== null ||
      (event.key !== "ArrowDown" && event.key !== "ArrowUp")
    ) {
      return;
    }
    const active = document.activeElement;
    const typing =
      active instanceof HTMLInputElement ||
      active instanceof HTMLTextAreaElement ||
      active instanceof HTMLSelectElement;
    if (typing || menuRoot.contains(active) || context.contains(active)) {
      return;
    }
    event.preventDefault();
    focusMenu();
  });

  const contextFocusables = (): HTMLElement[] => {
    const panel = context.querySelector<HTMLElement>(
      "[data-menu-panel]:not([hidden])",
    );
    if (panel === null) {
      return [];
    }
    return Array.from(
      panel.querySelectorAll<HTMLElement>(
        'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => element.offsetParent !== null);
  };

  const focusMenu = (): void => {
    const selected =
      items.find((item) => item.getAttribute("aria-current") === "true") ??
      items[0]!;
    selected.focus({ preventScroll: false });
  };

  const enterContext = (): void => {
    const first = contextFocusables()[0];
    if (first !== undefined) {
      first.focus({ preventScroll: false });
    }
  };

  const moveContextFocus = (direction: 1 | -1): void => {
    const focusables = contextFocusables();
    if (focusables.length === 0) {
      focusMenu();
      return;
    }
    const index = focusables.indexOf(document.activeElement as HTMLElement);
    if (index < 0) {
      focusables[direction === 1 ? 0 : focusables.length - 1]?.focus();
      return;
    }
    const next = index + direction;
    if (next < 0 || next >= focusables.length) {
      focusMenu();
      return;
    }
    focusables[next]?.focus();
  };

  let direction: "up" | "down" | null = null;
  let lastDirectionAt = 0;
  let acceptHeld = false;
  let backHeld = false;

  const readGamepad = (): GamepadSnapshot | null => {
    if (
      entryView.hidden ||
      document.querySelector("dialog[open]") !== null ||
      !document.hasFocus()
    ) {
      return null;
    }
    const pads = navigator.getGamepads?.() ?? [];
    for (const pad of pads) {
      if (pad === null || !pad.connected) {
        continue;
      }
      const button = (index: number): boolean =>
        pad.buttons[index]?.pressed === true;
      const axisX = pad.axes[0] ?? 0;
      const axisY = pad.axes[1] ?? 0;
      return {
        up: button(12) || axisY < -STICK_THRESHOLD,
        down: button(13) || axisY > STICK_THRESHOLD,
        left: button(14) || axisX < -STICK_THRESHOLD,
        right: button(15) || axisX > STICK_THRESHOLD,
        accept: button(0),
        back: button(1),
      };
    }
    return null;
  };

  const applyNavigation = (snapshot: GamepadSnapshot): void => {
    const now = performance.now();
    const wantsDirection: "up" | "down" | null = snapshot.up
      ? "up"
      : snapshot.down
        ? "down"
        : null;

    if (wantsDirection !== direction) {
      direction = wantsDirection;
      lastDirectionAt = 0;
    } else if (
      wantsDirection !== null &&
      now - lastDirectionAt < GAMEPAD_REPEAT_MS
    ) {
      return;
    }

    if (wantsDirection === "up" || wantsDirection === "down") {
      const delta = wantsDirection === "down" ? 1 : -1;
      const focused = document.activeElement;
      const typing =
        focused instanceof HTMLInputElement ||
        focused instanceof HTMLTextAreaElement ||
        focused instanceof HTMLSelectElement;
      if (typing) {
        // D-pad in the room-code field should still reach the menu rather than
        // trapping focus in a native text control.
        focused.blur();
        focusMenu();
      } else if (context.contains(document.activeElement)) {
        moveContextFocus(delta);
      } else {
        const itemsArray = items;
        const index = itemsArray.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        if (index < 0) {
          focusMenu();
        } else {
          itemsArray[
            (index + delta + itemsArray.length) % itemsArray.length
          ]?.focus();
        }
      }
      lastDirectionAt = now;
    }

    if (snapshot.accept && !acceptHeld) {
      const active = document.activeElement;
      if (menuRoot.contains(active)) {
        enterContext();
      } else if (active instanceof HTMLElement) {
        active.click();
      }
    }
    acceptHeld = snapshot.accept;

    if (snapshot.back && !backHeld) {
      const focused = document.activeElement;
      if (
        focused instanceof HTMLInputElement ||
        focused instanceof HTMLTextAreaElement ||
        focused instanceof HTMLSelectElement
      ) {
        focused.blur();
      }
      focusMenu();
    }
    backHeld = snapshot.back;
  };

  window.setInterval(() => {
    const snapshot = readGamepad();
    if (snapshot !== null) {
      applyNavigation(snapshot);
    } else {
      direction = null;
      acceptHeld = false;
      backHeld = false;
    }
  }, GAMEPAD_POLL_MS);
}

function bindRoomCodeMirror(): void {
  const wrapper = document.querySelector<HTMLElement>("[data-code-input]");
  if (wrapper === null) {
    return;
  }
  const input = wrapper.querySelector<HTMLInputElement>("input");
  const slots = wrapper.querySelectorAll<HTMLElement>("[data-code-slot]");
  if (input === null) {
    return;
  }

  const render = (): void => {
    const cleaned = input.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
    if (input.value !== cleaned) {
      input.value = cleaned;
    }
    slots.forEach((slot, index) => {
      const character = cleaned[index] ?? "";
      slot.textContent = character;
      slot.dataset.filled = String(character !== "");
    });
  };

  input.addEventListener("input", render);
  render();
}
