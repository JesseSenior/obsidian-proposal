import { setIcon } from 'obsidian';
import { difference } from '../diff';
import type { Snapshot } from '../types';

export function renderFiles(container: HTMLElement, snapshots: Snapshot[], tree: boolean, active: string | undefined, open: (path: string) => void, act: (snapshot: Snapshot, action: 'apply' | 'clear') => void): void {
	container.empty();
	container.classList.toggle('is-tree', tree);
	container.dataset.proposalIndent = '0';
	if (!snapshots.length) container.createEl('p', { text: 'No pending proposals.' });
	const folders = new Map<string, HTMLElement>();
	folders.set('', container);
	for (const snapshot of snapshots) {
		let parent = container;
		const parts = snapshot.path.split('/');
		if (tree) {
			for (let index = 1; index < parts.length; index++) {
				const key = parts.slice(0, index).join('/');
				let folder = folders.get(key);
				if (!folder) {
					const details = parent.createEl('details', { cls: 'proposal-folder-entry tree-item nav-folder' });
					details.open = true;
					const title = details.createEl('summary', { cls: 'tree-item-self nav-folder-title mod-collapsible' });
					const inset = Number(parent.dataset.proposalIndent ?? 0);
					const padding = parseFloat(getComputedStyle(title).paddingInlineStart);
					title.style.marginInlineStart = `${-inset}px`;
					title.style.paddingInlineStart = `${padding + inset}px`;
					const icon = title.createDiv({ cls: 'tree-item-icon collapse-icon' });
					setIcon(icon, 'chevron-down');
					title.createSpan({ cls: 'tree-item-inner nav-folder-title-content', text: parts[index - 1] });
					folder = details.createDiv({ cls: 'proposal-folder tree-item-children nav-folder-children' });
					const style = getComputedStyle(folder);
					folder.dataset.proposalIndent = String(inset + parseFloat(style.marginInlineStart) + parseFloat(style.paddingInlineStart) + parseFloat(style.borderInlineStartWidth));
					folders.set(key, folder);
				}
				parent = folder;
			}
		}
		const { added, deleted } = difference(snapshot.current, snapshot.proposal.text);
		const row = parent.createDiv({ cls: 'proposal-file' });
		row.dataset.path = snapshot.path;
		row.classList.toggle('is-tree', tree);
		const button = row.createEl('button', { cls: 'proposal-file-open', attr: { title: snapshot.path } });
		if (tree) {
			button.classList.add('tree-item-self', 'nav-file-title');
			const inset = Number(parent.dataset.proposalIndent ?? 0);
			const padding = parseFloat(getComputedStyle(button).paddingInlineStart);
			row.style.marginInlineStart = `${-inset}px`;
			button.style.paddingInlineStart = `${padding + inset}px`;
		}
		button.createSpan({ cls: 'proposal-file-name', text: parts.at(-1) });
		if (!tree) button.createSpan({ cls: 'proposal-file-path', text: snapshot.path });
		button.createSpan({ cls: 'proposal-file-counts', text: `+${added} -${deleted} #${snapshot.proposal.comments.length}` });
		row.classList.toggle('is-active', snapshot.path === active);
		button.addEventListener('click', () => open(snapshot.path));
		const actions = row.createDiv({ cls: 'proposal-row-actions' });
		for (const [action, label, icon] of [['apply', 'Apply file', 'check'], ['clear', 'Clear file', 'undo-2']] as const) {
			const control = actions.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': `${label}: ${snapshot.path}` } });
			control.dataset.action = action;
			setIcon(control, icon);
			control.addEventListener('click', () => act(snapshot, action));
		}
	}
}
