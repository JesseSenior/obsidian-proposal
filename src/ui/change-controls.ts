import { setIcon } from 'obsidian';
import type { MergeView } from '@codemirror/merge';

export function changeControls(document: Document, getMerge: () => MergeView, apply: (text: string) => void): HTMLElement {
	const controls = document.createElement('div');
	controls.className = 'proposal-change-controls';
	controls.addEventListener('mousedown', event => { event.preventDefault(); event.stopPropagation(); });
	for (const [label, icon, cancel] of [['Apply change', 'arrow-left', false], ['Cancel change', 'x', true]] as const) {
		const button = controls.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': label } });
		setIcon(button, icon);
		button.addEventListener('click', () => {
			const merge = getMerge();
			const chunk = merge.chunks[Number(controls.dataset.chunk)];
			if (!chunk) return;
			const [source, target, from, to, targetFrom, targetTo] = cancel
				? [merge.a, merge.b, chunk.fromA, chunk.toA, chunk.fromB, chunk.toB]
				: [merge.b, merge.a, chunk.fromB, chunk.toB, chunk.fromA, chunk.toA];
			let insert = source.state.doc.sliceString(from, Math.max(from, to - 1));
			if (from !== to && targetTo <= target.state.doc.length) insert += '\n';
			const end = Math.min(target.state.doc.length, targetTo);
			if (cancel) target.dispatch({ changes: { from: targetFrom, to: end, insert }, userEvent: 'input' });
			else apply(target.state.doc.sliceString(0, targetFrom) + insert + target.state.doc.sliceString(end));
		});
	}
	return controls;
}
