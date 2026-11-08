# Third-Party Notices

## Vendored Content Scripts

- `content_scripts/Readability.js` and `content_scripts/Readability-readerable.js` originate from Mozilla Readability and contain Copyright (c) 2010 Arc90 Inc notices. Their retained headers specify Apache License 2.0. See [LICENSES/Apache-2.0.txt](LICENSES/Apache-2.0.txt).
- `content_scripts/JSDOMParser.js` originates from Mozilla Readability and is covered by Mozilla Public License 2.0, as stated in its retained header. See [LICENSES/MPL-2.0.txt](LICENSES/MPL-2.0.txt).

The source files retain their upstream revision URLs. Their original licenses apply to those files; the project's AGPL license does not replace them.

## Package Dependencies

The popup bundles React and React DOM (MIT), React Redux and Redux (MIT), Turndown (MIT), and dependencies installed through npm. Build tooling is recorded in the root and popup package manifests and lockfiles. Each package retains its own license and attribution in its installed distribution. Dependencies are not vendored in this repository; inspect their npm package metadata and license files when redistributing builds.