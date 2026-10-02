import { mapComments } from './comments';
import { applyPatch, type FilePatch } from './patch';
import type { Comment, Proposal, ProposalIO, Snapshot } from './types';
import { matchesPath, type PathChange } from './paths';

export function validatePath(path: string, configDir: string): string {
	if (typeof path !== 'string' || !path || path.startsWith('/') || /[\\:]/.test(path) || [...path].some(char => char.charCodeAt(0) < 32) ||
		path.split('/').some(part => !part || part === '.' || part === '..' || part.startsWith('.')) ||
		path === configDir || path.startsWith(`${configDir}/`) || !path.endsWith('.md')) {
		throw new Error('Use a vault-relative Markdown path outside hidden and configuration folders.');
	}
	return path;
}

export function isSupportedPath(path: string, configDir: string): boolean {
	try { validatePath(path, configDir); return true; }
	catch { return false; }
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
	private pending = Promise.resolve<unknown>(undefined);
	private changes: PathChange[] = [];
	private failedMoves = new Set<string>();
	private listeners = new Set<(path: string) => void>();
	constructor(private io: ProposalIO, private ready = true) {}

	subscribe(listener: (path: string) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private queue<T>(work: () => Promise<T>): Promise<T> {
		const next = this.pending.catch(() => undefined).then(work);
		this.pending = next;
		return next;
	}

	private run<T>(path: string, work: () => Promise<T>): Promise<T> {
		validatePath(path, this.io.configDir);
		return this.queue(work);
	}

	private currentPath(path: string): string | undefined {
		for (const change of this.changes) {
			if (!matchesPath(path, change)) continue;
			if (!change.newPath) return undefined;
			path = change.newPath + path.slice(change.oldPath.length);
		}
		return path;
	}

	private async current(path: string): Promise<string | null> {
		if (!this.ready) throw new Error('Vault is still loading.');
		for (;;) {
			const currentPath = this.currentPath(path);
			if (currentPath === undefined) return null;
			try {
				const text = await this.io.originalExists(currentPath) ? await this.io.readCurrent(currentPath) : null;
				if (currentPath === this.currentPath(path)) return text;
			} catch (error) {
				if (currentPath !== this.currentPath(path)) continue;
				const exists = await this.io.originalExists(currentPath);
				if (currentPath !== this.currentPath(path)) continue;
				if (!exists) return null;
				throw error;
			}
		}
	}

	private async load(path: string): Promise<Snapshot> {
		const current = await this.current(path);
		if (current === null) throw new Error(`Markdown note not found: ${path}`);
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

	paths(): Promise<string[]> { return this.queue(() => this.listPaths()); }

	private async listPaths(): Promise<string[]> {
		return (await this.io.list()).filter(path => path.startsWith('.proposal/') && path.endsWith('.md.json'))
			.map(path => path.slice(10, -5)).sort();
	}

	start(): Promise<Snapshot[]> {
		this.ready = true;
		return this.active().then(snapshots => {
			for (const listener of this.listeners) listener('');
			return snapshots;
		});
	}

	active(): Promise<Snapshot[]> {
		return this.queue(async () => {
			if (!this.ready) return [];
			const snapshots: Snapshot[] = [];
			for (const path of await this.listPaths()) {
				validatePath(path, this.io.configDir);
				if (this.failedMoves.has(path)) continue;
				const current = await this.current(path);
				if (current === null) {
					await this.remove(path);
					continue;
				}
				const raw = await this.io.read(`.proposal/${path}.json`);
				if (raw === null) continue;
				const proposal = decode(raw);
				if (current !== proposal.text || proposal.comments.length) snapshots.push({ path, current, proposal });
			}
			return snapshots;
		});
	}

	changePath(change: PathChange): Promise<void> {
		// Reads already in flight must follow the note before its proposal migration reaches the queue.
		this.changes.push(change);
		return this.queue(async () => {
			try {
				const paths = (await this.listPaths()).filter(path => matchesPath(path, change));
				if (change.newPath && paths.length) {
					for (const path of paths) this.failedMoves.add(path);
					const first = change.newPath + paths[0]!.slice(change.oldPath.length);
					const suffix = change.folder ? '' : '.json';
					if (isSupportedPath(first, this.io.configDir) && await this.io.renameCase(`.proposal/${change.oldPath}${suffix}`, `.proposal/${change.newPath}${suffix}`)) {
						for (const path of paths) this.failedMoves.delete(path);
						return;
					}
				}
				for (const path of paths) {
					const destination = change.newPath && change.newPath + path.slice(change.oldPath.length);
					if (destination === path) { this.failedMoves.delete(path); continue; }
					if (destination && isSupportedPath(destination, this.io.configDir)) {
						const raw = await this.io.read(`.proposal/${path}.json`);
						if (raw !== null) await this.io.write(`.proposal/${destination}.json`, raw);
					}
					await this.remove(path);
				}
			} finally {
				this.changes.splice(this.changes.indexOf(change), 1);
				for (const listener of this.listeners) listener(change.newPath ?? change.oldPath);
			}
		});
	}

	private async remove(path: string): Promise<void> {
		await this.io.remove(`.proposal/${path}.json`);
		this.failedMoves.delete(path);
		for (const listener of this.listeners) listener(path);
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
			const path = this.currentPath(snapshot.path);
			if (!path) throw new Error(`Markdown note not found: ${snapshot.path}`);
			await this.io.writeCurrent(path, snapshot.current, replacement);
			for (const listener of this.listeners) listener(snapshot.path);
		});
	}

	clear(path: string): Promise<void> {
		return this.run(path, async () => {
			await this.remove(path);
		});
	}
}
