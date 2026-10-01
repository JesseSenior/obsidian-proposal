# CLI reference

[Back to README](../README.md)


The plugin exposes async methods on `app.plugins.getPlugin("proposal")`. Invoke them with the official Obsidian CLI `eval` command. The plugin must be enabled and Obsidian must be running.

```sh
obsidian vault="My vault" eval 'code=(async () => JSON.stringify(await app.plugins.getPlugin("proposal").proposal_help()))()'
```

Successful calls return `{ "ok": true, "result": ... }`; invalid requests return `{ "ok": false, "error": "..." }`. The CLI prints a `=> ` prefix before the JSON result. For an edit, inspect **every** `result.files[].ok`: some files can succeed while others fail.

| Method | Request | Result |
| --- | --- | --- |
| `proposal_read` | `{path, startLine?, endLine?}` | Proposal text, or original text when no proposal exists; includes comments. Inclusive line ranges are 1-based. |
| `proposal_edit` | `{patch?, removeComments?}` | Per-file success/failure and `removedCommentIds`. `removeComments` maps original paths to arrays of comment IDs. |
| `proposal_diff` | `{path?}` | Without a path: active files and line/comment counts. With a path: changed text blocks and comments. |
| `proposal_help` | No arguments | Schemas, examples, restrictions, and review URL format. |

By default, full reads with 2,000 or more words return an outline and line ranges. Request a range to read a section. The setting is configurable. Word counts use language-aware segmentation, including Chinese. Notes without headings return a suggested initial range.

### Patch format

Use original vault-relative paths, not `.proposal` paths. Only existing Markdown files can be updated. Create, delete, rename, hidden paths, and configuration paths are rejected.

```diff
*** Begin Patch
*** Update File: Notes/Example.md
@@
 Context line
-Old sentence.
+New sentence.
*** End Patch
```

Use exact, unique context. `@@ Heading text` searches after that exact line. `*** End of File` requires the block to match the end. Numbered unified-diff headers and fuzzy matching are not supported. Existing line endings and the terminal-newline convention are retained.

All blocks for one file must match before that file is saved. A failed file does not prevent successful updates to other files. Invalid patch framing or unsupported create/delete operations reject the entire request before writes.

Tool edits remove comments that overlap changed lines and return their IDs. Context-only lines retain comments. Manual editor transactions retain comments and move their ranges; deleting all selected text leaves an empty anchor at the deletion point. Explicitly remove a comment when it is no longer needed:

```json
{"removeComments":{"Notes/Example.md":["comment-id"]}}
```

### Pass requests without shell interpolation

Pass the full `code=` argument as one process argument. Do not put untrusted note text into a shell command. For example, this Python call passes a JSON request through `subprocess` without a shell:

```python
import json
import subprocess

request = {"path": "Notes/Example.md", "startLine": 1, "endLine": 20}
encoded = json.dumps(json.dumps(request))
code = (
    '(async () => JSON.stringify(await '
    'app.plugins.getPlugin("proposal").proposal_read('
    f'JSON.parse({encoded}))))()'
)
subprocess.run(["obsidian", "vault=My vault", "eval", "code=" + code], check=True)
```

Use `proposal_edit` for edits, then open the review URL for the user. The tools do not apply proposals to original notes.
