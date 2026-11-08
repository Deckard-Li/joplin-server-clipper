# Security Policy

## Reporting

Do not report exploitable vulnerabilities, credentials, or private note content in public issues. Use this repository's private vulnerability reporting feature under the GitHub **Security** tab. If it is unavailable, contact the maintainer through their GitHub profile to arrange a private channel before disclosing details.

Include the affected revision, browser and server versions, reproduction steps using a test account, and the likely impact. Remove passwords, session tokens, cookies, and private content from logs and screenshots.

## Support and Boundaries

Security fixes target the current main branch. There is no guaranteed response time or production support commitment.

Direct-server mode requires HTTPS for remote servers, stores a server session token locally, and does not support end-to-end encrypted accounts. Protect the browser profile and do not use this experimental fork for sensitive accounts until you have verified its behavior. The extension requests broad host access for clipping pages and downloading their resources.