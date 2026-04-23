import { afterEach, beforeEach } from "vitest";
import { installChromeMock, uninstallChromeMock, ChromeMock } from "./chrome_mock";

// Make chrome available on globalThis before any test imports code that touches `chrome.*`.
// Individual tests can reset it via beforeEach.

declare global {
  // eslint-disable-next-line no-var
  var __chromeMock: ChromeMock;
}

beforeEach(() => {
  globalThis.__chromeMock = installChromeMock();
});

afterEach(() => {
  uninstallChromeMock();
});
