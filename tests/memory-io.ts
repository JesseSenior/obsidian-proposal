import assert from 'node:assert/strict';
import type { ProposalIO } from '../src/types';

export class MemoryIO implements ProposalIO {
	configDir = 'config';
	originals = new Map([['One.md', 'old\ncontext\n'], ['Two.md', 'second\n']]);
	files = new Map<string, string>();
	originalExists(path: string): Promise<boolean> { return Promise.resolve(this.originals.has(path)); }
	readCurrent(path: string): Promise<string> {
		const text = this.originals.get(path);
		return text === undefined ? Promise.reject(new Error('Note not found')) : Promise.resolve(text);
	}
	async writeCurrent(path: string, expected: string, text: string): Promise<void> {
		assert.equal(await this.readCurrent(path), expected);
		this.originals.set(path, text);
	}
	read(path: string): Promise<string | null> { return Promise.resolve(this.files.get(path) ?? null); }
	write(path: string, text: string): Promise<void> { this.files.set(path, text); return Promise.resolve(); }
	renameCase(): Promise<boolean> { return Promise.resolve(false); }
	remove(path: string): Promise<void> { this.files.delete(path); return Promise.resolve(); }
	list(): Promise<string[]> { return Promise.resolve([...this.files.keys()]); }
}
