// SPDX-License-Identifier: AGPL-3.0-only
// The one number the app knows itself by: `version` in package.json, put in
// at build time by vite.config.ts. Nothing else spells it out — the top bar,
// the imprint and every saved project read it from here — so a release is a
// bump of that one field and a tag (docs/development.md, "Releases").

export const APP_VERSION: string = __APP_VERSION__

/** Where this version's source is, as the AGPL asks a network service to
 *  offer it: the GitHub key in the top bar and About link here. */
export const SOURCE_URL = 'https://github.com/Uname-a/banana-scan'
