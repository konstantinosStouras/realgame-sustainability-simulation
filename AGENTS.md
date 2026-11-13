# Project working instructions

This directory is the working checkout of `konstantinosStouras/realgame-sustainability-simulation`.

Keep website changes, original supporting code, and public project notes in this repository. The user requests that completed updates be committed and pushed to GitHub. Review changes and run relevant checks before pushing; never commit unrelated work or secrets.

The branded website is published at https://www.stouras.com/sustainability-simulation/ from a dedicated folder in the parent Pages repository. Build the public asset allowlist with node scripts/build-static.mjs before updating that folder. Use relative asset paths so the site works at that subpath. Do not add a CNAME or change the parent website's domain configuration.

Never put RealGame login credentials, private emails, student data, or proprietary materials into the public site or repository.
