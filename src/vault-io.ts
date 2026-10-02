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

	async originalExists(path: string): Promise<boolean> {
		// A cached file can still be present while a filesystem rename awaits its vault event.
		return await this.vault.adapter.exists(path, true) || this.vault.getAbstractFileByPath(path) instanceof TFile;
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

	private async createParents(path: string): Promise<void> {
		const parts = path.split('/');
		const adapter = this.vault.adapter;
		for (let index = 1; index < parts.length; index++) {
			const folder = parts.slice(0, index).join('/');
			if (await adapter.exists(folder, true)) continue;
			if (await adapter.exists(folder)) {
				const { folders } = await adapter.list(parts.slice(0, index - 1).join('/'));
				const actual = folders.find(entry => entry.toLowerCase() === folder.toLowerCase());
				if (!actual) throw new Error(`Cannot resolve proposal folder: ${folder}`);
				await adapter.rename(actual, folder);
			} else {
				try { await adapter.mkdir(folder); }
				catch (error) { if (!await adapter.exists(folder, true)) throw error; }
			}
		}
	}

	async write(path: string, text: string): Promise<void> {
		await this.createParents(path);
		await this.vault.adapter.write(path, text);
	}

	async renameCase(path: string, destination: string): Promise<boolean> {
		if (path === destination || path.toLowerCase() !== destination.toLowerCase()) return false;
		const adapter = this.vault.adapter;
		if (!await adapter.exists(destination) || await adapter.exists(destination, true)) return false;
		await adapter.rename(path, destination);
		return true;
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
