import { TFile, type Vault } from 'obsidian';
import type { ProposalIO } from './types';

export class VaultIO implements ProposalIO {
	constructor(private vault: Vault) {}
	get configDir(): string { return this.vault.configDir; }

	private file(path: string): TFile {
		const file = this.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) throw new Error(`Markdown note not found: ${path}`);
		return file;
	}

	readCurrent(path: string): Promise<string> { return this.vault.read(this.file(path)); }

	async writeCurrent(path: string, expected: string, text: string): Promise<void> {
		await this.vault.process(this.file(path), current => {
			if (current !== expected) throw new Error('Original changed. Review the comparison and apply again.');
			return text;
		});
	}

	async read(path: string): Promise<string | null> {
		return await this.vault.adapter.exists(path) ? this.vault.adapter.read(path) : null;
	}

	async write(path: string, text: string): Promise<void> {
		const parts = path.split('/');
		for (let index = 1; index < parts.length; index++) {
			const folder = parts.slice(0, index).join('/');
			if (!await this.vault.adapter.exists(folder)) {
				try { await this.vault.adapter.mkdir(folder); }
				catch (error) { if (!await this.vault.adapter.exists(folder)) throw error; }
			}
		}
		await this.vault.adapter.write(path, text);
	}

	async remove(path: string): Promise<void> {
		if (await this.vault.adapter.exists(path)) await this.vault.adapter.remove(path);
	}

	async list(): Promise<string[]> {
		if (!await this.vault.adapter.exists('.proposal')) return [];
		const walk = async (path: string): Promise<string[]> => {
			const { files, folders } = await this.vault.adapter.list(path);
			return [...files, ...(await Promise.all(folders.map(walk))).flat()];
		};
		return walk('.proposal');
	}
}
