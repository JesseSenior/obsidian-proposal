import { Notice, Plugin } from 'obsidian';
import { DEFAULT_SETTINGS, ProposalSettingTab, type ProposalSettings } from './settings';
import { ProposalStore } from './store';
import { ProposalTools, toolResult } from './tools';
import { message, type EditRequest, type ReadRequest } from './types';
import { VaultIO } from './vault-io';
import { registerStatus } from './ui/status';
import { ProposalView, VIEW_TYPE } from './ui/view';
import { ProposalSidebar } from './ui/sidebar';
import { registerPaths } from './lifecycle';

export default class ProposalPlugin extends Plugin {
	settings!: ProposalSettings;
	tools!: ProposalTools;

	async onload(): Promise<void> {
		this.settings = { ...DEFAULT_SETTINGS, ...await this.loadData() as Partial<ProposalSettings> };
		if (!Number.isInteger(this.settings.readLimitWords) || this.settings.readLimitWords < 1) this.settings.readLimitWords = DEFAULT_SETTINGS.readLimitWords;
		this.tools = new ProposalTools(new ProposalStore(new VaultIO(this.app.vault), false), () => this.settings.readLimitWords);
		const sidebar = new ProposalSidebar(this, this.tools, path => this.openReview(path));
		this.registerView(VIEW_TYPE, leaf => new ProposalView(leaf, this.tools, path => sidebar.select(path)));
		registerPaths(this, this.tools);
		sidebar.start();
		this.addSettingTab(new ProposalSettingTab(this.app, this));
		this.addCommand({ id: 'open-review', name: 'Open review', callback: () => this.openReview() });
		this.registerObsidianProtocolHandler('proposal', params => this.openReview(params.file));
		registerStatus(this, () => { void this.openReview(this.app.workspace.getActiveFile()?.path); });
	}

	async openReview(path?: string): Promise<void> {
		try {
			const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0] ?? this.app.workspace.getLeaf('tab');
			await leaf.setViewState({ type: VIEW_TYPE, active: true });
			await this.app.workspace.revealLeaf(leaf);
			if (path && leaf.view instanceof ProposalView) await leaf.view.openFile(path);
		} catch (error) { new Notice(message(error)); }
	}

	proposal_read(request: ReadRequest) { return toolResult(() => this.tools.read(request)); }
	proposal_edit(request: EditRequest) { return toolResult(() => this.tools.edit(request)); }
	proposal_diff(request: { path?: string } = {}) { return toolResult(() => this.tools.diff(request)); }
	proposal_help() { return toolResult(() => this.tools.help()); }
}
