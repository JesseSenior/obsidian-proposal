# Proposal

Review proposed Markdown edits in Obsidian before you apply them to your notes. Compare the current note with an editable proposal, add comments, and accept or discard changes.

Proposal works locally and makes no network requests. It supports desktop Obsidian **1.13.7 or later**.

## Install

Build from source:

```sh
npm ci
npm run build
```

Copy `main.js`, `manifest.json`, and `styles.css` to `<vault>/.obsidian/plugins/proposal/`. If your vault uses a different configuration folder, use that folder instead of `.obsidian`.

Enable **Proposal** in **Settings → Community plugins**.

## Review changes

Open a Markdown note and select the diff icon beside the pencil in the status bar. You can also run **Proposal: Open review** from the command palette.

- **Edit:** Change the proposal on the right. Edits save automatically.
- **Comment:** Select text and select **Comment**. Hover over underlined text to read a comment. Double-click it to edit or remove it.
- **Apply:** Use the left arrow between the panels to apply one change, or the check icon above the panels to apply the current file.
- **Discard:** Use the X below a change arrow to discard that change, or the undo icon above the panels to clear the current proposal.
- **Fold:** Use the map icon to switch folding on or off. Drag either edge of a folded bar to show more or fewer lines. Select its label to expand the section.

The **Proposal files** sidebar supports list and tree views. Counts such as `+3 -1 #2` mean three added lines, one deleted line, and two comments. Hover over a file to apply or clear it. The sidebar toolbar has **Apply all** and **Clear all**; both ask for confirmation.

Applying changes keeps comments. Clearing removes proposals and comments without changing original notes. If an original changes before you apply, review the updated comparison and select Apply again.

## Use with CLI tools

Enable **Settings → General → Command line interface** in Obsidian. Keep Obsidian running with Proposal enabled.

```sh
obsidian vault="My vault" eval 'code=(async () => JSON.stringify(await app.plugins.getPlugin("proposal").proposal_help()))()'
```

The plugin provides four methods: `proposal_read`, `proposal_edit`, `proposal_diff`, and `proposal_help`. Tools prepare edits; you apply them in the review view.

See the [CLI reference](docs/cli.md) for request formats, patch examples, JSON output, and shell quoting.

An older Obsidian installer can show an outdated-installer warning and omit asynchronous CLI results even when an edit succeeds. Update the desktop installer before use. Do not repeat an edit only because its output is missing.

Open a review with a URL. The `file` parameter is optional:

```text
obsidian://proposal?vault=My%20vault&file=Notes%2FExample.md
```

## Saved proposals

Proposals and comments stay in the vault's `.proposal` folder and survive restarts. Opening or reading a note does not create a proposal. Clear a proposal before you rename or delete its original note.

Use the plugin or CLI methods to change proposals. If you sync the vault, check that your sync service includes `.proposal`.

## Development

```sh
npm test
npm run lint
npm run build
```

For live Obsidian checks, install the build in a disposable vault whose name starts with `proposal-smoke-`, then open that vault:

```sh
npm run test:obsidian -- proposal-smoke-example
```

The live test creates and changes test notes. Do not run it in a working vault. Generated build files are excluded from Git.
