// MASH clone — showcase + dogfood of the @vivify/core public API.
// Stub only; the character picker, animation grid, and type-to-balloon UI
// land in Cycle 4.

import { name } from '@vivify/core';

const app = document.querySelector<HTMLDivElement>('#app');
if (app) {
  app.textContent = `vivify demo — powered by ${name} (scaffold stub)`;
}
