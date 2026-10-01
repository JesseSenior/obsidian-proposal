import { mapComments } from './comments';
import { applyPatch, type FilePatch } from './patch';
import type { Comment, Proposal, ProposalIO, Snapshot } from './types';

export function validatePath(path: string, configDir: string): string {
	if (typeof path !== 'string' || !path || path.startsWith('/') || /[\\:]/.test(path) || [...path].some(char => char.charCodeAt(0) < 32) ||
		path.split('/').some(part => !part || part === '.' || part === '..' || part.startsWith('.')) ||
		path === configDir || path.startsWith(`${configDir}/`) || !path.endsWith('.md')) {
		throw new Error('Use a vault-relative Markdown path outside hidden and configuration folders.');
	}
	return path;
}

function decode(raw: string): Proposal {
	const value: unknown = JSON.parse(raw);
	if (!value || typeof value !== 'object') throw new Error('Invalid proposal JSON.');
	const record = value as Proposal;
	if (record.version !== 1 || typeof record.text !== 'string' || !Array.isArray(record.comments)) {
		throw new Error('Unsupported proposal format.');
	}
	const ids = new Set<string>();
	for (const comment of record.comments) {
		if (!comment || typeof comment.id !== 'string' || !comment.id || ids.has(comment.id) ||
			typeof comment.text !== 'string' || !Number.isInteger(comment.from) || !Number.isInteger(comment.to) ||
			comment.from < 0 || comment.to < comment.from || comment.to > record.text.length) {
			throw new Error('Invalid proposal comment.');
		}
		ids.add(comment.id);
	}
	return record;
}

export class ProposalStore {
	private queues = new Map<string, Promise<unknown>>();
	private listeners = new Set<(path: string) => void>();
	constructor(private io: ProposalIO) {}

	subscribe(listener: (path: string) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private run<T>(path: string, work: () => Promise<T>): Promise<T> {
		validatePath(path, this.io.configDir);
		const previous = this.queues.get(path) ?? Promise.resolve();
		const next = previous.catch(() => undefined).then(work);
		this.queues.set(path, next);
		void next.finally(() => {
			if (this.queues.get(path) === next) this.queues.delete(path);
		}).catch(() => undefined);
		return next;
	}

	private async load(path: string): Promise<Snapshot> {
		const current = await this.io.readCurrent(path);
		const raw = await this.io.read(`.proposal/${path}.json`);
		return { path, current, proposal: raw === null ? { version: 1, text: current, comments: [] } : decode(raw) };
	}

	read(path: string): Promise<Snapshot> {
		return this.run(path, () => this.load(path));
	}

	private async save(path: string, proposal: Proposal): Promise<void> {
		await this.io.write(`.proposal/${path}.json`, JSON.stringify(proposal, null, 2) + '\n');
		for (const listener of this.listeners) listener(path);
	}

	async paths(): Promise<string[]> {
		return (await this.io.list()).filter(path => path.startsWith('.proposal/') && path.endsWith('.md.json'))
			.map(path => path.slice(10, -5)).sort();
	}

	async active(): Promise<Snapshot[]> {
		const snapshots = await Promise.all((await this.paths()).map(path => this.read(path)));
		return snapshots.filter(({ current, proposal }) => current !== proposal.text || proposal.comments.length);
	}

	edit(path: string, patches: FilePatch[], removeIds: string[] = []): Promise<string[]> {
		return this.run(path, async () => {
			const { proposal } = await this.load(path);
			const removed = new Set<string>();
			for (const patch of patches) {
				const result = applyPatch(proposal.text, patch);
				for (const edit of result.edits) {
					const mapped = mapComments(proposal.comments, edit, true);
					proposal.comments = mapped.comments;
					mapped.removed.forEach(id => removed.add(id));
				}
				proposal.text = result.text;
			}
			for (const id of removeIds) {
				if (removed.has(id)) continue;
				if (!proposal.comments.some(comment => comment.id === id)) throw new Error(`Unknown comment: ${id}`);
				proposal.comments = proposal.comments.filter(comment => comment.id !== id);
				removed.add(id);
			}
			await this.save(path, proposal);
			return [...removed];
		});
	}

	manual(path: string, expected: Proposal, text: string, comments: Comment[]): Promise<void> {
		return this.run(path, async () => {
			const { proposal } = await this.load(path);
			if (JSON.stringify(proposal) !== JSON.stringify(expected)) {
				throw new Error('Proposal changed outside this editor. Reopen the review before editing again.');
			}
			await this.save(path, { version: 1, text, comments });
		});
	}

	apply(snapshot: Snapshot, replacement = snapshot.proposal.text): Promise<void> {
		return this.run(snapshot.path, async () => {
			const latest = await this.load(snapshot.path);
			if (latest.current !== snapshot.current || latest.proposal.text !== snapshot.proposal.text) {
				throw new Error('Text changed. Review the refreshed comparison and apply again.');
			}
			await this.io.writeCurrent(snapshot.path, snapshot.current, replacement);
			for (const listener of this.listeners) listener(snapshot.path);
		});
	}

	clear(path: string): Promise<void> {
		return this.run(path, async () => {
			await this.io.remove(`.proposal/${path}.json`);
			for (const listener of this.listeners) listener(path);
		});
	}
}
