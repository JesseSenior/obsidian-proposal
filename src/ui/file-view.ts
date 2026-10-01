import { ItemView, Notice, setIcon, type WorkspaceLeaf } from 'obsidian';
import type { ProposalTools } from '../tools';
import { message } from '../types';
import { renderFiles } from './files';
import { ProposalView, VIEW_TYPE, type ReviewAction } from './view';

export const FILE_VIEW_TYPE = 'proposal-files';

export class ProposalFileView extends ItemView {
	private tree = false;
	private path?: string;
	private timer?: number;
	private request = 0;
	private closed = false;
	private files!: HTMLElement;

	constructor(leaf: WorkspaceLeaf, private tools: ProposalTools, private openFile: (path: string) => Promise<void>) { super(leaf); }
	getViewType(): string { return FILE_VIEW_TYPE; }
	getDisplayText(): string { return 'Proposal files'; }
	getIcon(): string { return 'git-compare-arrows'; }

	async onOpen(): Promise<void> {
		this.contentEl.addClass('proposal-file-view');
		const toolbar = this.contentEl.createDiv({ cls: 'nav-header' });
		const buttons = toolbar.createDiv({ cls: 'nav-buttons-container' });
		const button = buttons.createEl('button', { cls: 'clickable-icon nav-action-button proposal-file-toggle', attr: { 'aria-label': 'Show tree' } });
		setIcon(button, 'list-tree');
		this.registerDomEvent(button, 'click', () => {
			this.tree = !this.tree;
			const label = this.tree ? 'Show list' : 'Show tree';
			button.setAttribute('aria-label', label);
			setIcon(button, this.tree ? 'list' : 'list-tree');
			this.scheduleRefresh();
		});
		const actions: [ReviewAction, string, string][] = [
			['applyAll', 'Apply all', 'check-check'], ['clearAll', 'Clear all', 'undo-2'],
		];
		for (const [action, label, icon] of actions) {
			const control = buttons.createEl('button', { cls: 'clickable-icon nav-action-button proposal-file-action', attr: { 'aria-label': label } });
			control.dataset.action = action;
			setIcon(control, icon);
			this.registerDomEvent(control, 'click', () => {
				void this.runAction(action).catch(error => { new Notice(message(error)); });
			});
		}
		this.files = this.contentEl.createDiv({ cls: 'proposal-files' });
		this.register(this.tools.store.subscribe(() => this.scheduleRefresh()));
		this.registerEvent(this.app.vault.on('modify', file => { if (file.path.endsWith('.md')) this.scheduleRefresh(); }));
		await this.refresh();
	}

	private async runAction(action: ReviewAction): Promise<void> {
		let view = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0]?.view;
		if (!(view instanceof ProposalView) && this.path) {
			await this.openFile(this.path);
			view = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0]?.view;
		}
		if (!(view instanceof ProposalView)) throw new Error('Open a proposal first.');
		await view.runAction(action);
	}

	select(path: string): void { this.path = path; this.scheduleRefresh(); }

	private scheduleRefresh(): void {
		window.clearTimeout(this.timer);
		if (!this.closed) this.timer = window.setTimeout(() => {
			void this.refresh().catch(error => { new Notice(message(error)); });
		}, 100);
	}

	private async refresh(): Promise<void> {
		const request = ++this.request;
		const snapshots = await this.tools.store.active();
		if (this.closed || request !== this.request) return;
		renderFiles(this.files, snapshots, this.tree, this.path, path => {
			void this.openFile(path).catch(error => { new Notice(message(error)); });
		}, (snapshot, action) => {
			void (async () => {
				await this.tools.flush();
				if (action === 'apply') await this.tools.store.apply(snapshot);
				else await this.tools.store.clear(snapshot.path);
			})().catch(error => { new Notice(message(error)); });
		});
	}

	onClose(): Promise<void> {
		this.closed = true;
		window.clearTimeout(this.timer);
		return Promise.resolve();
	}
}
