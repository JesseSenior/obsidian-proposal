import { StateEffect, StateField, type Extension } from '@codemirror/state';
import { EditorView, hoverTooltip, showTooltip, tooltips, type Tooltip } from '@codemirror/view';
import type { Comment } from '../types';

type CommentPopup = { ids: string[]; pos: number } | 'dismissed' | null;
const setPopup = StateEffect.define<CommentPopup>();
const popup = StateField.define<CommentPopup>({
	create: () => null,
	update(value, transaction) {
		if (transaction.docChanged || transaction.selection) value = null;
		for (const effect of transaction.effects) if (effect.is(setPopup)) value = effect.value;
		return value;
	},
});

interface CommentActions {
	comments(): Comment[];
	add(text: string): void;
	edit(id: string, text: string): void;
	remove(id: string): void;
}

function editorForm(view: EditorView, parent: HTMLElement, text: string, save: (text: string) => void, remove?: () => void): void {
	const form = parent.createEl('form', { cls: 'proposal-comment-form' });
	const input = form.createEl('textarea', { cls: 'proposal-comment-input', attr: { 'aria-label': 'Comment', placeholder: 'Write a comment' } });
	input.value = text;
	input.required = true;
	const controls = form.createDiv({ cls: 'proposal-comment-actions' });
	controls.createEl('button', { text: 'Save', attr: { type: 'submit' } });
	const close = () => view.dispatch({ effects: setPopup.of('dismissed') });
	if (remove) controls.createEl('button', { text: 'Remove', attr: { type: 'button' } }).addEventListener('click', () => { remove(); close(); });
	controls.createEl('button', { text: 'Cancel', attr: { type: 'button' } }).addEventListener('click', close);
	form.addEventListener('submit', event => {
		event.preventDefault();
		if (!input.value.trim()) return;
		save(input.value.trim());
		close();
	});
	input.addEventListener('keydown', event => {
		if (event.key === 'Escape') { event.preventDefault(); close(); view.focus(); }
		if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); form.requestSubmit(); }
	});
}

export function commentUI(actions: CommentActions, container: HTMLElement): Extension {
	const fitWidth = (view: EditorView, dom: HTMLElement) => {
		const pane = container.getBoundingClientRect();
		const editor = view.dom.getBoundingClientRect();
		const width = Math.min(container.ownerDocument.documentElement.clientWidth - 4, pane.right, editor.right) - Math.max(4, pane.left, editor.left);
		dom.style.maxWidth = `${Math.max(0, Math.min(320, width))}px`;
	};
	return [popup, tooltips({
		parent: container.ownerDocument.body,
		tooltipSpace: view => {
			const pane = container.getBoundingClientRect();
			const editor = view.dom.getBoundingClientRect();
			const viewport = container.ownerDocument.documentElement;
			return {
				left: Math.max(4, pane.left, editor.left), right: Math.min(viewport.clientWidth - 4, pane.right, editor.right),
				top: Math.max(4, pane.top), bottom: Math.min(viewport.clientHeight - 4, pane.bottom),
			};
		},
	}),
		showTooltip.compute(['selection', 'doc', popup], state => {
			const editing = state.field(popup);
			if (editing === 'dismissed') return null;
			const selection = state.selection.main;
			if (!editing && selection.empty) return null;
			return {
				pos: editing?.pos ?? selection.head,
				above: true, arrow: true,
				create(view) {
					const dom = view.dom.ownerDocument.createElement('div');
					dom.className = 'proposal-comment-popup';
					dom.setAttribute('role', 'dialog');
					dom.setAttribute('aria-label', editing ? 'Edit comment' : 'Comment on selection');
					if (editing) {
						for (const comment of actions.comments().filter(comment => editing.ids.includes(comment.id))) {
							editorForm(view, dom, comment.text, text => actions.edit(comment.id, text), () => actions.remove(comment.id));
						}
					} else {
						const button = dom.createEl('button', { cls: 'proposal-selection-comment', text: 'Comment' });
						button.addEventListener('mousedown', event => event.preventDefault());
						button.addEventListener('click', () => {
							dom.empty();
							editorForm(view, dom, '', text => actions.add(text));
							dom.querySelector('textarea')?.focus();
							view.requestMeasure();
						});
					}
					fitWidth(view, dom);
					return { dom, positioned: () => fitWidth(view, dom), mount: () => { if (editing) dom.querySelector('textarea')?.focus(); } };
				},
			} satisfies Tooltip;
		}),
		hoverTooltip((view, pos) => {
			const comments = actions.comments().filter(comment => comment.from <= pos && (pos < comment.to || comment.from === comment.to && pos === comment.from));
			if (!comments.length) return null;
			return { pos, above: true, arrow: true, create() {
				const dom = view.dom.ownerDocument.createElement('div');
				dom.className = 'proposal-comment-hover';
				comments.forEach(comment => dom.createDiv({ text: comment.text }));
				fitWidth(view, dom);
				return { dom, positioned: () => fitWidth(view, dom.parentElement!) };
			} };
		}, { hoverTime: 200 }),
		EditorView.domEventHandlers({
			dblclick(event, view) {
				const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-comment-id]') : null;
				const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
				const comments = actions.comments().filter(comment => comment.id === target?.dataset.commentId ||
					pos !== null && comment.from <= pos && pos <= comment.to);
				if (!comments.length) return false;
				event.preventDefault();
				view.dispatch({ effects: setPopup.of({ ids: comments.map(comment => comment.id), pos: pos ?? comments[0]!.from }) });
				return true;
			},
		}),
	];
}
