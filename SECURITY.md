# Security policy

## Reporting a vulnerability

Please report security issues privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**. Don't open a public issue for security problems.

Include the steps to reproduce, the browser you used, and what an attacker could achieve. You can expect a reply within a week.

## Scope

QR Studio is a static site that runs entirely in the browser. It has no server, accounts or database. Issues worth reporting include:

- Script injection through share links, history, CSV files, uploaded images or decoded QR codes
- Ways to bypass the blocked-link rules (`javascript:`, `data:` and similar)
- The QR checker reporting a dangerous code as safe
- Weaknesses in passphrase-locked share links
- Any request that sends user data off the device

## How the app protects users

| Area | Protection |
| --- | --- |
| Page | Content Security Policy allows only same-origin scripts, styles, fonts and workers; blocks plugins, `<base>` changes, form submissions and frames. `no-referrer` policy. |
| Dependencies | Libraries and fonts are bundled, not loaded from CDNs. Their SHA-256 hashes are in `SHA256SUMS` and checked in CI. |
| Generated codes | `javascript:`, `data:`, `file:`, `vbscript:`, `blob:` and similar links are refused. Warnings for `http`, IP addresses, punycode lookalike domains, link shorteners, unusual ports and `user@host` disguises. |
| Checking codes | Images are decoded locally. Content is shown as text only, links are never opened automatically, and dangerous ones get no open button. |
| Secrets | Wi-Fi passwords are never written to history and are left out of share links unless the user opts in. Share links can be encrypted with AES-256-GCM, using a key derived from a passphrase with PBKDF2-SHA256 (310,000 iterations). |
| Untrusted input | Share-link and stored settings are checked against allow-lists before rendering. Field lengths are capped. Uploaded logos (SVG included) are re-encoded to PNG. Size limits on logos (5 MB), CSV files (2 MB) and checked images (10 MB). |

## Known limits

- GitHub Pages can't send HTTP headers, so the policy is set with a `<meta>` tag. This means `frame-ancestors` (clickjacking protection) is not available.
- A passphrase-locked link is only as strong as its passphrase. Use a long one and send it through a different channel than the link.
