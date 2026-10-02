import { Notice, TFolder, type Plugin } from 'obsidian';
import type { PathChange } from './paths';
import type { ProposalTools } from './tools';
import { message } from './types';
import { ProposalView, VIEW_TYPE } from './ui/view';

export function registerPaths(plugin: Plugin, tools: ProposalTools): void {
	let disposed = false;
	plugin.register(() => { disposed = true; });
	const change = (change: PathChange) => {
		const migration = tools.store.changePath(change);
		for (const leaf of plugin.app.workspace.getLeavesOfType(VIEW_TYPE)) {
			if (leaf.view instanceof ProposalView) leaf.view.changePath(change);
		}
		void migration.catch(error => { new Notice(message(error)); });
	};
	plugin.registerEvent(plugin.app.vault.on('rename', (file, oldPath) => {
		if (file instanceof TFolder || oldPath.endsWith('.md')) change({ oldPath, newPath: file.path, folder: file instanceof TFolder });
	}));
	plugin.registerEvent(plugin.app.vault.on('delete', file => {
		if (file instanceof TFolder || file.path.endsWith('.md')) change({ oldPath: file.path, folder: file instanceof TFolder });
	}));
	plugin.app.workspace.onLayoutReady(() => {
		if (!disposed) void tools.store.start().catch(error => { new Notice(message(error)); });
	});
}
