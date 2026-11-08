# Contributing

Bug reports and focused pull requests are welcome. For bugs, include the browser and version, Joplin Server version, reproduction steps, expected behavior, and sanitized errors. Never include passwords, session tokens, private notes, or a production database.

## Local Checks

Use Node.js 22.19 or newer. Run `npm ci`, `npm test`, and `npm run build` from the repository root. Load the built extension in your browser and verify the changed workflow with a test account. For changes to `util/clipperUtils.ts`, rebuild before reloading the extension.

Keep changes focused, preserve upstream attribution and third-party license headers, and use tabs and single quotes in authored JavaScript and TypeScript. Add tests for meaningful behavior and failure cases. Do not commit dependencies, generated bundles, environment files, or credentials.

## Pull Requests

Describe the behavior change, relevant limitations, and checks performed. Authentication, encryption safety, resource handling, and desktop compatibility require particular care. Contributions are distributed under this project's AGPL-3.0-or-later license; no separate contributor agreement is required.