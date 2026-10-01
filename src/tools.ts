import { difference } from './diff';
import { parsePatch, type FilePatch } from './patch';
import { readResult } from './read';
import { ProposalStore } from './store';
import { message, type EditRequest, type ReadRequest } from './types';

export class ProposalTools {
	readonly flushers = new Set<() => Promise<void>>();
	constructor(readonly store: ProposalStore, private readLimit: () => number) {}

	async flush(): Promise<void> {
		for (const flush of this.flushers) await flush();
	}

	async read(request: ReadRequest) {
		await this.flush();
		return readResult(await this.store.read(request.path), request, this.readLimit());
	}

	async edit(request: EditRequest) {
		await this.flush();
		const grouped = new Map<string, FilePatch[]>();
		for (const patch of request.patch ? parsePatch(request.patch) : []) {
			const group = grouped.get(patch.path) ?? [];
			group.push(patch);
			grouped.set(patch.path, group);
		}
		for (const path of Object.keys(request.removeComments ?? {})) {
			if (!grouped.has(path)) grouped.set(path, []);
		}
		if (!grouped.size) throw new Error('Supply a patch or comment IDs to remove.');
		const files = [];
		for (const [path, patches] of grouped) {
			try {
				const removedCommentIds = await this.store.edit(path, patches, request.removeComments?.[path]);
				files.push({ path, ok: true, removedCommentIds });
			} catch (error) {
				files.push({ path, ok: false, error: message(error) });
			}
		}
		return { files };
	}

	async diff(request: { path?: string } = {}) {
		await this.flush();
		if (request.path) {
			const snapshot = await this.store.read(request.path);
			return { path: request.path, ...difference(snapshot.current, snapshot.proposal.text), comments: snapshot.proposal.comments };
		}
		return { files: (await this.store.active()).map(snapshot => {
			const { added, deleted } = difference(snapshot.current, snapshot.proposal.text);
			return { path: snapshot.path, added, deleted, comments: snapshot.proposal.comments.length };
		}) };
	}

	help() {
		return {
			tools: {
				proposal_read: { path: 'Vault-relative existing Markdown path', startLine: 'Optional inclusive 1-based line', endLine: 'Optional inclusive 1-based line' },
				proposal_edit: { patch: 'Optional apply_patch text; Update File blocks only', removeComments: 'Optional object mapping paths to comment ID arrays' },
				proposal_diff: { path: 'Optional Markdown path; omit for workspace summary' },
				proposal_help: {},
			},
			readLimitWords: this.readLimit(),
			storage: '.proposal/<original path>.json; full proposal text and comments; no base copy',
			patchExample: '*** Begin Patch\n*** Update File: Note.md\n@@\n-old text\n+new text\n*** End Patch',
			rules: [
				'Use exact, unique context, with optional @@ heading anchors. No fuzzy matches or numbered unified-diff headers.',
				'Each file update is atomic. Other files can succeed if one fails. Inspect each files[].ok result.',
				'Only existing Markdown notes are supported. No create, delete, move, hidden, or configuration paths.',
				'Tool edits remove overlapping comments and return their IDs. Manual edits retain and move comments.',
				'Read and open do not create proposals. Read falls back to the original when no proposal exists.',
				'Comment offsets are zero-based UTF-16 offsets with exclusive ends.',
				'Apply and clear are user actions in the review view. Never edit originals to apply a proposal.',
			],
			cli: 'obsidian eval \'code=(async () => JSON.stringify(await app.plugins.getPlugin("proposal").proposal_help()))()\'',
			reviewUrl: 'obsidian://proposal?vault=<URL-encoded vault name>&file=<URL-encoded original path>',
		};
	}
}

export async function toolResult<T>(work: () => T | Promise<T>) {
	try { return { ok: true as const, result: await work() }; }
	catch (error) { return { ok: false as const, error: message(error) }; }
}
