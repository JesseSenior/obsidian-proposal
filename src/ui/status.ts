import { MarkdownView, setIcon, type Plugin } from 'obsidian';

export function registerStatus(plugin: Plugin, open: () => void): void {
	const item = plugin.addStatusBarItem();
	item.addClass('proposal-status');
	item.setAttribute('role', 'button');
	item.setAttribute('tabindex', '0');
	item.setAttribute('aria-label', 'Review proposal for active note');
	item.setAttribute('title', 'Review proposal for active note');
	setIcon(item, 'git-compare-arrows');
	plugin.registerDomEvent(item, 'click', open);
	plugin.registerDomEvent(item, 'keydown', event => {
		if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); }
	});
	const bar = item.parentElement;
	if (!bar) return;
	const place = () => {
		const view = plugin.app.workspace.getMostRecentLeaf()?.view;
		item.toggle(view instanceof MarkdownView && Boolean(view.file));
		const mode = bar.querySelector('.status-bar-item.plugin-editor-status');
		if (mode && mode !== item && mode.parentElement === bar && item.nextElementSibling !== mode) bar.insertBefore(item, mode);
	};
	place();
	plugin.registerEvent(plugin.app.workspace.on('active-leaf-change', place));
	plugin.registerEvent(plugin.app.workspace.on('file-open', place));
	plugin.registerEvent(plugin.app.workspace.on('layout-change', place));
	const observer = new MutationObserver(place);
	observer.observe(bar, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
	plugin.register(() => observer.disconnect());
}
