import { ItemView, Notice, setIcon, type WorkspaceLeaf } from 'obsidian';
import type { ProposalTools } from '../tools';
import { message, type Snapshot } from '../types';
import { ReviewEditor } from './editor';
import { confirmAction } from './modals';

export type ReviewAction = 'applyCurrent' | 'clearCurrent' | 'applyAll' | 'clearAll';

export const VIEW_TYPE = 'proposal-review';

export class ProposalView extends ItemView {
	private editor?: ReviewEditor;
	private snapshot?: Snapshot;
	private panel!: HTMLElement;
	private title!: HTMLElement;
	private dirty = false;
	private foldEnabled = true;
	private timer?: number;
	private refreshTimer?: number;
	private pending = Promise.resolve();
	private closed = false;
	private snapshots: Snapshot[] = [];
	private navigationRequest = 0;
	private listRequest = 0;
	private flushBound = () => this.flush();

	constructor(leaf: WorkspaceLeaf, private tools: ProposalTools, private selectFile: (path: string) => void) { super(leaf); }
	getViewType(): string { return VIEW_TYPE; }
	getDisplayText(): string { return 'Proposal review'; }
	getIcon(): string { return 'git-compare-arrows'; }

	async onOpen(): Promise<void> {
		this.contentEl.addClass('proposal-view');
		this.title = this.contentEl.createEl('h3', { text: 'Proposal' });
		const toolbar = this.contentEl.createDiv({ cls: 'proposal-toolbar' });
		for (const [action, label, icon] of [['applyCurrent', 'Apply current file', 'check'], ['clearCurrent', 'Clear current file', 'undo-2']] as const) {
			const button = toolbar.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': label } });
			setIcon(button, icon);
			button.dataset.action = action;
			this.registerDomEvent(button, 'click', () => this.perform(() => this.runAction(action)));
		}
		const fold = toolbar.createEl('button', { cls: 'clickable-icon is-active', attr: { 'aria-label': 'Fold unchanged lines', 'aria-pressed': 'true' } });
		fold.dataset.action = 'toggleFold';
		setIcon(fold, 'map');
		this.registerDomEvent(fold, 'click', () => {
			this.foldEnabled = !this.foldEnabled;
			fold.setAttribute('aria-pressed', String(this.foldEnabled));
			fold.toggleClass('is-active', this.foldEnabled);
			this.editor?.setFolding(this.foldEnabled);
		});
		const body = this.contentEl.createDiv({ cls: 'proposal-body' });
		const review = body.createDiv({ cls: 'proposal-review' });
		const labels = review.createDiv({ cls: 'proposal-labels' });
		labels.createSpan({ text: 'Current' });
		labels.createSpan({ text: 'Proposal' });
		this.panel = review.createDiv({ cls: 'proposal-editors' });
		this.tools.flushers.add(this.flushBound);
		this.register(() => this.tools.flushers.delete(this.flushBound));
		this.register(this.tools.store.subscribe(() => this.scheduleRefresh()));
		this.registerEvent(this.app.vault.on('modify', file => {
			if (file.path.endsWith('.md')) this.scheduleRefresh();
		}));
		await this.refreshFiles();
	}

	async runAction(action: ReviewAction): Promise<void> { await this[action](); }

	private perform(work: () => Promise<void>): void {
		void work().catch(error => { new Notice(message(error)); });
	}

	private scheduleRefresh(): void {
		window.clearTimeout(this.refreshTimer);
		if (!this.closed) this.refreshTimer = window.setTimeout(() => this.perform(() => this.refresh()), 100);
	}

	async openFile(path: string): Promise<void> {
		const navigation = ++this.navigationRequest;
		await this.flush();
		const snapshot = await this.tools.store.read(path);
		if (navigation !== this.navigationRequest || this.closed) return;
		this.show(snapshot);
		await this.refreshFiles();
	}

	private show(snapshot: Snapshot): void {
		if (this.closed) return;
		this.editor?.destroy();
		this.panel.empty();
		this.snapshot = snapshot;
		this.dirty = false;
		this.title.setText(`Proposal: ${snapshot.path}`);
		this.selectFile(snapshot.path);
		this.editor = new ReviewEditor(this.panel, snapshot, () => this.changed(), text => this.perform(() => this.applyCurrent(text)));
		this.editor.setFolding(this.foldEnabled);
	}

	private changed(): void {
		this.dirty = true;
		window.clearTimeout(this.timer);
		this.timer = window.setTimeout(() => this.perform(() => this.flush()), 300);
	}

	async flush(): Promise<void> {
		window.clearTimeout(this.timer);
		// Queue saves and capture the editor state only when the previous save has finished.
		this.pending = this.pending.catch(() => undefined).then(async () => {
			while (this.dirty && this.snapshot && this.editor) {
				const snapshot = this.snapshot;
				const proposal = this.editor.proposal();
				this.dirty = false;
				try {
					await this.tools.store.manual(snapshot.path, snapshot.proposal, proposal.text, proposal.comments);
					snapshot.proposal = proposal;
				} catch (error) { this.dirty = true; throw error; }
			}
		});
		await this.pending;
	}

	private async refreshFiles(): Promise<void> {
		const request = ++this.listRequest;
		const snapshots = await this.tools.store.active();
		if (request !== this.listRequest) return;
		this.snapshots = snapshots;
	}

	private async refresh(): Promise<void> {
		window.clearTimeout(this.refreshTimer);
		await this.flush();
		if (this.snapshot) {
			const displayed = this.snapshot;
			const next = await this.tools.store.read(displayed.path);
			if (this.snapshot !== displayed || this.closed) return;
			if (this.dirty) return this.refresh();
			if (next.current !== displayed.current || JSON.stringify(next.proposal) !== JSON.stringify(displayed.proposal)) this.show(next);
		}
		await this.refreshFiles();
	}

	private async applyCurrent(replacement?: string): Promise<void> {
		if (!this.snapshot || !this.editor) throw new Error('Select a file first.');
		const displayed = { ...this.snapshot, proposal: this.editor.proposal() };
		await this.tools.flush();
		try { await this.tools.store.apply(displayed, replacement); }
		finally { await this.refresh(); }
	}

	private async applyAll(): Promise<void> {
		await this.tools.flush();
		const files = this.snapshots.filter(snapshot => snapshot.current !== snapshot.proposal.text);
		if (!files.length) return;
		if (!await confirmAction(this.app, 'Apply all proposals?', `Write changes to ${files.length} original notes? Comments will remain.`)) return;
		await this.tools.flush();
		const failures: string[] = [];
		for (const file of files) {
			try { await this.tools.store.apply(file); }
			catch (error) { failures.push(`${file.path}: ${message(error)}`); }
		}
		await this.refresh();
		if (failures.length) throw new Error(failures.join('\n'));
	}

	private async clearCurrent(): Promise<void> {
		await this.tools.flush();
		if (!this.snapshot) throw new Error('Select a file first.');
		await this.tools.store.clear(this.snapshot.path);
		await this.refresh();
	}

	private async clearAll(): Promise<void> {
		await this.tools.flush();
		const paths = await this.tools.store.paths();
		if (!paths.length) return;
		if (!await confirmAction(this.app, 'Clear all proposals?', `Remove ${paths.length} stored proposals and their comments? Original notes will remain unchanged.`)) return;
		await this.tools.flush();
		for (const path of paths) await this.tools.store.clear(path);
		await this.refresh();
	}

	async onClose(): Promise<void> {
		await this.flush();
		this.closed = true;
		window.clearTimeout(this.timer);
		window.clearTimeout(this.refreshTimer);
		this.tools.flushers.delete(this.flushBound);
		this.editor?.destroy();
	}
}
