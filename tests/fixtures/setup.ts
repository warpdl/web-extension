import { afterEach, beforeEach } from "vitest";
import { installChromeMock, uninstallChromeMock, ChromeMock } from "./chrome_mock";

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
