# Working in this repository

See [AGENTS.md](AGENTS.md) for the code: setup, the checks to run, and the rules they enforce.

- `main` is what's released, or ready to be. Never push to `main`, merge into it, or open a pull request into it, except the owner's release pull request from `dev`.
- Do the work on `dev`. Push small changes to `dev` directly, or make a branch from `dev` and open the pull request into it with `gh pr create --base dev`.
- Changes reach `main` only by a pull request from `dev`, which the owner (Uname-a) reviews and merges. Only merge commits are allowed. `main` needs the `secrets` and `npm-licenses` checks to pass.
- CI (unit tests, build, browser checks) runs on GitHub after a merge into `main`, and costs some 100 runner-minutes. To test `dev` or a branch first, run the checks here (AGENTS.md), or start CI there by hand: `gh workflow run ci.yml --ref dev`.
- This is a fork. Run `node scripts/rebrand.mjs --check` before committing; a deliberate mention of the upstream project's name needs `rebrand:keep` on its line, or `rebrand:off` / `rebrand:on` around it. Merging upstream's work is described in docs/upstream.md.
- Never tag a release, publish a package (the agent server is not on npm, and `PUBLISHED` in mcp/src/update.js stays false unless the owner says), host the app, or make the repository public: the owner decides those.
