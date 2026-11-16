<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Security

## Reporting a problem

Please report a security problem **privately**, not in a public issue: on
GitHub, **Security → Report a vulnerability** in this repository
(https://github.com/Uname-a/banana-scan/security/advisories/new). Say what is
affected, how to reproduce it, and what an attacker could do with it. You will
get an answer within a week; a fix goes out as soon as it is ready, and you
are credited in the changelog unless you would rather not be.

Banana Scan is a fork of ScanRuler. A problem that is in ScanRuler too is <!-- rebrand:keep -->
worth reporting to its authors as well, once it is fixed here or with their
agreement.

## What counts

Banana Scan runs in the browser and keeps the files it opens there. The parts
that reach beyond the page are where a problem matters most:

- **The agent server** (`mcp/`): it listens on 127.0.0.1 only, lets in pages
  from this computer and `--allow-origin` addresses only, and pairs a page by
  a token. A way to reach it from another machine or another website, to get
  past the token, or to make it read or write files outside the folders it is
  given, is a security problem.
- **Pairing links** (`#agent=port:token`) and anything that would leak the
  token to a site other than the page.
- **Opening files**: a scan, project or STEP file that runs code, reads other
  files, or crashes the page in a way an attacker could aim.
- **The build and the release**: the workflows, and dependencies with a known
  vulnerability that Banana Scan's use of them reaches.

The supported version is the latest release and `dev`.
