import { Notice, type Plugin, type WorkspaceLeaf } from 'obsidian';
import type { ProposalTools } from '../tools';
import { message } from '../types';
import { FILE_VIEW_TYPE, ProposalFileView } from './file-view';
import { VIEW_TYPE } from './view';

export class ProposalSidebar {
	private root: WorkspaceLeaf | null = null;
	private reviewing = false;
	private previous: WorkspaceLeaf | null = null;
	private pending = Promise.resolve();
	private disposed = false;
	private path?: string;
	private available = false;
	private availabilityDirty = true;
	private timer?: number;

	constructor(private plugin: Plugin, private tools: ProposalTools, openFile: (path: string) => Promise<void>) {
		plugin.registerView(FILE_VIEW_TYPE, leaf => new ProposalFileView(leaf, tools, openFile));
	}

	start(): void {
		const workspace = this.plugin.app.workspace;
		const update = (force = false) => {
			this.pending = this.pending.then(() => this.update(force)).catch(error => { new Notice(message(error)); });
		};
		this.plugin.registerEvent(workspace.on('active-leaf-change', leaf => update(leaf?.view.getViewType() === VIEW_TYPE)));
		this.plugin.registerEvent(workspace.on('layout-change', () => update()));
		const changed = () => {
			this.availabilityDirty = true;
			window.clearTimeout(this.timer);
			this.timer = window.setTimeout(() => update(), 100);
		};
		this.plugin.register(this.tools.store.subscribe(changed));
		this.plugin.registerEvent(this.plugin.app.vault.on('modify', file => { if (file.path.endsWith('.md')) changed(); }));
		workspace.onLayoutReady(() => update());
		this.plugin.register(() => { this.disposed = true; window.clearTimeout(this.timer); });
	}

	select(path: string): void {
		this.path = path;
		for (const leaf of this.plugin.app.workspace.getLeavesOfType(FILE_VIEW_TYPE)) {
			if (leaf.view instanceof ProposalFileView) leaf.view.select(path);
		}
	}

	private async update(force: boolean): Promise<void> {
		if (this.disposed) return;
		if (this.availabilityDirty) {
			this.availabilityDirty = false;
			this.available = (await this.tools.store.active()).length > 0;
		}
		if (this.disposed) return;
		const workspace = this.plugin.app.workspace;
		const root = workspace.getMostRecentLeaf();
		if (!this.available && workspace.getLeavesOfType(VIEW_TYPE).length === 0) {
			this.root = root;
			this.reviewing = false;
			this.previous = null;
			const leaves = workspace.getLeavesOfType(FILE_VIEW_TYPE);
			if (workspace.getMostRecentLeaf(workspace.leftSplit)?.view.getViewType() === FILE_VIEW_TYPE) {
				const explorer = workspace.getLeavesOfType('file-explorer').find(leaf => leaf.getRoot() === workspace.leftSplit);
				if (explorer) await workspace.revealLeaf(explorer);
			}
			for (const leaf of leaves) leaf.detach();
			return;
		}
		const reviewing = root?.view.getViewType() === VIEW_TYPE;
		if (root === this.root && reviewing === this.reviewing && !(force && reviewing)) return;
		const wasReviewing = this.reviewing;
		this.root = root;
		this.reviewing = reviewing;
		if (reviewing) {
			if (!wasReviewing) this.previous = workspace.getMostRecentLeaf(workspace.leftSplit);
			let leaf = workspace.getLeavesOfType(FILE_VIEW_TYPE).find(candidate => candidate.getRoot() === workspace.leftSplit);
			if (!leaf) {
				leaf = workspace.getLeftLeaf(false) ?? undefined;
				if (!leaf) throw new Error('Cannot open the left sidebar.');
				await leaf.setViewState({ type: FILE_VIEW_TYPE });
			}
			if (this.disposed || workspace.getMostRecentLeaf() !== root) return;
			if (this.path && leaf.view instanceof ProposalFileView) leaf.view.select(this.path);
			await workspace.revealLeaf(leaf);
		} else if (wasReviewing) {
			const selected = workspace.getMostRecentLeaf(workspace.leftSplit);
			if (selected?.view.getViewType() !== FILE_VIEW_TYPE) return;
			const leaves: WorkspaceLeaf[] = [];
			workspace.iterateAllLeaves(leaf => { if (leaf.getRoot() === workspace.leftSplit) leaves.push(leaf); });
			const previous = this.previous && leaves.includes(this.previous) && this.previous.view.getViewType() !== FILE_VIEW_TYPE
				? this.previous : leaves.find(leaf => leaf.view.getViewType() === 'file-explorer');
			if (previous) await workspace.revealLeaf(previous);
		}
	}
}
