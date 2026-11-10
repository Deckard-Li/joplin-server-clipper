# Joplin Server Clipper

An unofficial, standalone browser extension for clipping web pages directly to a self-hosted Joplin Server, without running the Joplin desktop app. Derived from the open-source [Joplin Web Clipper](https://github.com/laurent22/joplin/tree/dev/packages/app-clipper). Not affiliated with or endorsed by Joplin or JOPLIN SAS.

## Features

- Connect directly to Joplin Server using its existing session and sync-item APIs; no server changes required.
- Clip simplified pages, complete pages as Markdown or HTML, selections, URLs, and screenshots.
- Select notebooks, create a Web Clippings notebook for an empty account, and apply tags.
- Archive images and embedded attachments as Joplin resources.
- Retain the original local desktop-clipper connection as an alternative.

## Build

The repository includes the built popup and content-script helper, so you can clone or download it and load the extension without installing Node.js. To rebuild from source, install Node.js 22.19 or newer, then run:

```sh
git clone https://github.com/Deckard-Li/joplin-server-clipper.git
cd joplin-server-clipper
npm ci
npm test
npm run build
```

The installation command also installs the popup dependencies from its lockfile. The build generates the content-script helper and popup bundle. No Joplin monorepo checkout is needed.

## Install

**Chrome, Edge, and other Chromium browsers:** Clone this repository or download and extract its ZIP. Open the browser's extensions page, enable developer mode, select **Load unpacked**, and choose the repository's root folder. No build step is required.

**Firefox:** Open `about:debugging`, select **This Firefox**, choose **Load Temporary Add-on**, and select this repository's `manifest.json`. Temporary add-ons are removed when Firefox restarts; permanent Firefox installation requires Mozilla signing.

## Connect

1. Open the extension and expand **Connection**.
2. Select **Joplin Server**.
3. Enter the server's base URL, email, and password, then select **Sign in**. Include any reverse-proxy path prefix, but do not append `/api`.
4. Select a notebook and clip. Empty accounts offer **Create Web Clippings notebook**.

Both HTTP and HTTPS are supported, including local-network URLs such as `http://192.168.1.20:22300` or `http://joplin.local:22300`. HTTP sends your password, session token, and note content unencrypted: use it only on a trusted local network and use HTTPS over the internet. This extension supports Joplin Server, not arbitrary WebDAV endpoints. New clips appear in other Joplin clients on their next sync. Select **Disconnect server** to return to the desktop connection.

The password is used only for sign-in and is not saved. The session token is kept in local extension storage, so protect your browser profile. Sign in again if the server session expires.

Closing the popup does not sign you out. After the first successful notebook discovery, reopening it reuses the saved session and a browser-session cache of notebooks and tags without contacting the server first. There is no continuously open connection or keep-alive loop; browsers can suspend extension background workers. The server is contacted when clipping, and uploads still validate the account and destination before writing.

Use **Connection > Refresh notebooks and tags** after creating, renaming, or deleting notebooks or tags in another client. Signing in again and creating a notebook from the clipper also refresh this cache. Browser restart, extension reload, or disconnect clears the session cache, so the first opening afterwards must discover notebooks again. Browsers without session-storage support fall back to fresh discovery. Cached choices do not guarantee that the server is online or that your login is still valid; network and session errors are reported when a request is made.

## Limitations

- End-to-end encrypted accounts, including accounts retaining encryption keys, are rejected. Direct uploads are not encrypted by the extension; use desktop mode for these accounts.
- Shared notebooks and their descendants are excluded.
- The server's session API does not support accounts requiring two-factor authentication.
- Images and embedded attachments are downloaded without website cookies. Failed downloads fail the clip rather than silently omitting content. Each resource is limited to 20 MB.
- External stylesheets are not archived. HTML clips preserve extracted HTML and inline styling.
- Initial notebook discovery, explicit refresh, and live pre-upload validation read sync-item metadata and can be slow for large accounts. Reopening the popup in the same browser session reuses cached choices.
- Screenshots upload in the background; reopen the popup to see the result. Shortcut clipping retains the upstream popup-dependent behavior.
- Uploads are not transactional. A failed clip can leave uploaded resources or a note without all its tags; check before retrying.

This fork is experimental. Automated transport tests and a mocked popup flow have passed, but live-server synchronization and screenshot rendering still need verification. Before relying on it, clip a URL, a page with an image, a tagged note, and a screenshot to a test account, then sync a Joplin client and inspect the results.

## Development

```sh
npm test
npm run build
npm run watch
```

Reload the extension after rebuilding. See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidance and [SECURITY.md](SECURITY.md) for security reporting. GitHub Actions runs the tests and build and produces an installable extension artifact.

## License and Attribution

The Joplin-derived extension code is licensed under **AGPL-3.0-or-later**. See [LICENSE](LICENSE), [NOTICE.md](NOTICE.md), and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Original third-party license headers are preserved.

Joplin is a trademark of JOPLIN SAS. This fork uses independently generated icons instead of Joplin's restricted logos and icons.