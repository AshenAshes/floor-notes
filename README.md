# Floor notes

Floor notes is an [Obsidian](https://obsidian.md) plugin for reading and editing a dedicated Markdown note as a threaded conversation. Floors and replies remain ordinary, human-readable Markdown; the plugin supplies a focused Thread view, editing tools, favorites, and presentation options without moving the data into a separate database.

## Features

- Render a qualifying Markdown note as a Floor / Reply thread.
- Add, edit, delete, favorite, and sort floors from the Thread view.
- Browse favorite floors across notes in a dedicated sidebar.
- Choose Bubble, Glass, Paper, or Timeline thread layouts.
- Choose the host-adapted Obsidian theme or one of the bundled palettes, with light, dark, or automatic mode where supported.
- Render Markdown content in records, preserve source-oriented document edits, and keep drafts while composing.
- Fall back to Obsidian's native Markdown view if a thread cannot be parsed or rendered.

## Requirements

- Obsidian **1.8.7** or later.
- Plugin ID: `floor-notes`.

## Install from a release

1. Download `main.js`, `manifest.json`, and `styles.css` from a GitHub Release.
2. Create `<vault>/.obsidian/plugins/floor-notes/`.
3. Copy those three files into the new directory.
4. In Obsidian, reload community plugins and enable **Floor notes**.

## Thread file format

A thread is a Markdown file with the `floor-notes: 1` frontmatter marker. Floors begin with a column-zero `## Floor` heading; replies begin with a column-zero `### Reply` heading under the preceding floor.

```markdown
---
floor-notes: 1
floor-notes-sort: asc
---
# Project discussion

## Floor
[id:: floor-20260716-120000-abcde123]
[date:: 2026-07-16 12:00:00]
[favorite:: true]

The first floor is regular Markdown content.

### Reply
[id:: reply-20260716-120500-xyz789ab]
[date:: 2026-07-16 12:05:00]

Replies are attached to the closest preceding floor.
```

`[favorite:: true]` is optional and applies only to floors. Record IDs follow the `floor-YYYYMMDD-HHMMSS-suffix` or `reply-YYYYMMDD-HHMMSS-suffix` format. Dates are required and are preserved as entered.

The format shown above is the supported file structure; keep record headings and metadata at column zero so the parser can identify them reliably.

## Commands and use

- **Open in floor view** — open the active qualifying Markdown note in the Thread view.
- **Enable floor view for this note** — add the required frontmatter marker to the active Markdown note, then open it in the Thread view.
- **Open favorite floors** — show the favorites sidebar.

Within the Thread view, use the header and record controls to create records, edit content, favorite floors, change sort order, and choose a view style. The plugin settings page controls the default view style, theme, color mode, locale, and automatic routing behavior.

## Development

This project uses Node.js 20 in CI. After cloning the repository, install the locked dependency set:

```sh
npm ci
```

| Task | Command |
| --- | --- |
| Start the JavaScript bundler watch | `npm run dev` |
| Create production assets | `npm run build` |
| Type-check | `npm run typecheck` |
| Run ESLint | `npm run lint` |
| Run Stylelint | `npm run lint:css` |
| Run tests once | `npm run test` |
| Watch tests | `npm run test:watch` |
| Run coverage | `npm run test:coverage` |
| Run all project checks and production build | `npm run verify` |
| Inspect the npm package contents | `npm pack --dry-run` |

`npm run verify` runs type checking, JavaScript and CSS linting, project-specific CSS/source/locale/theme checks, Vitest, a production build, and the release contract check. The CSS bundle is generated when the build or development command starts; restart the development command after changing CSS sources.

## Continuous integration and releases

Pull requests and pushes to `main` run the verification workflow. Successful runs retain `main.js`, `manifest.json`, and `styles.css` as a short-lived workflow artifact.

A GitHub Release is created only when a maintainer pushes a tag in the exact `vX.Y.Z` form, such as `v0.1.0`. The tag must match the versions in `package.json`, `manifest.json`, and `versions.json`; all verification and package checks must pass before the release assets are published.

Before using releases, configure the GitHub repository to allow Actions to request `contents: write`, protect `main`, require the CI check, and restrict who can create or update `v*` tags.

## License

[MIT](LICENSE)
