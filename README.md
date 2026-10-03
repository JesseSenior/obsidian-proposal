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

单文件 Apply 和 Apply all 成功后，会删除对应 proposal 及其全部评论；Apply all 也处理仅有评论或没有正文差异的存储记录。Clear 和 Clear all 删除对应 proposal 及其全部评论，不修改原笔记。当前文件的 proposal 删除后，对比页会清空。两栏之间的箭头仅应用一处差异，保留 proposal 和评论。如果应用前原笔记已更改，请检查更新后的对比，再执行 Apply；应用失败的 proposal 会保留。

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

Proposals and comments stay in the vault's `.proposal` folder and survive restarts. Opening or reading a note does not create a proposal. Renaming or moving a note or folder while the plugin is enabled moves its proposals and comments to the new paths. If a destination already has a proposal, the incoming proposal replaces it.

Deleting an original note also deletes its proposal and comments. After the vault loads, and when the proposal list refreshes, proposals whose original notes no longer exist are deleted automatically. Renames made while the plugin is disabled cannot be tracked; proposals left at the old paths are deleted on reload. Moving a note outside the supported Markdown paths also removes its proposal.

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
