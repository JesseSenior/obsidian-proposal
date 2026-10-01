import { Compartment, EditorState } from '@codemirror/state';
import { Decoration, EditorView, keymap, lineNumbers, WidgetType, type ViewUpdate } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { MergeView } from '@codemirror/merge';
import type { Comment, Proposal, Snapshot } from '../types';
import { commentUI } from './comment-ui';
import { ReviewFolds } from './folds';
import { changeControls } from './change-controls';

class CommentAnchor extends WidgetType {
	constructor(private comment: Comment) { super(); }
	toDOM(view: EditorView): HTMLElement {
		const marker = view.dom.ownerDocument.createElement('span');
		marker.className = 'proposal-comment-mark proposal-comment-anchor';
		marker.dataset.commentId = this.comment.id;
		marker.textContent = '|';
		marker.setAttribute('aria-label', this.comment.text);
		return marker;
	}
	ignoreEvent(): boolean { return false; }
}

function positionInEditor(text: string, position: number): number {
	return text.slice(0, position).replace(/\r\n/g, '\n').length;
}

function positionInFile(text: string, position: number, eol: string): number {
	return position + (eol.length - 1) * (text.slice(0, position).match(/\n/g)?.length ?? 0);
}

export class ReviewEditor {
	readonly merge: MergeView;
	comments: Comment[];
	private marks = new Compartment();
	private eol: string;
	private updating = false;
	private folds = new ReviewFolds();

	constructor(parent: HTMLElement, snapshot: Snapshot, private changed: () => void, apply: (text: string) => void) {
		this.eol = snapshot.proposal.text.includes('\r\n') ? '\r\n' : '\n';
		this.comments = structuredClone(snapshot.proposal.comments);
		const extensions = [lineNumbers(), markdown(), EditorView.lineWrapping, this.folds.extension];
		this.merge = new MergeView({
			parent,
			a: { doc: snapshot.current, extensions: [...extensions, EditorState.readOnly.of(true), EditorView.editable.of(false)] },
			b: { doc: snapshot.proposal.text, extensions: [...extensions, EditorState.lineSeparator.of(this.eol),
				history(), keymap.of([...defaultKeymap, ...historyKeymap]), this.marks.of([]),
				commentUI({
					comments: () => {
						const text = this.merge.b.state.sliceDoc();
						return this.comments.map(comment => ({ ...comment,
							from: positionInEditor(text, comment.from), to: positionInEditor(text, comment.to) }));
					},
					add: text => this.addComment({ id: crypto.randomUUID(), ...this.selection(), text }),
					edit: (id, text) => this.editComment(id, text),
					remove: id => this.removeComment(id),
				}, parent),
				EditorView.updateListener.of(update => this.onUpdate(update))] },
			revertControls: 'b-to-a',
			renderRevertControl: () => changeControls(parent.ownerDocument, () => this.merge, text => {
				const originalEol = snapshot.current.includes('\r\n') ? '\r\n' : '\n';
				apply(text.replace(/\n/g, originalEol));
			}),
		});
		this.folds.attach(this.merge);
		this.showComments();
	}

	private onUpdate(update: ViewUpdate): void {
		if (this.updating || !update.docChanged) return;
		for (const transaction of update.transactions) {
			if (!transaction.docChanged) continue;
			const before = transaction.startState.sliceDoc();
			const after = transaction.state.doc.toString();
			this.comments = this.comments.map(comment => ({ ...comment,
				from: positionInFile(after, transaction.changes.mapPos(positionInEditor(before, comment.from), -1), this.eol),
				to: positionInFile(after, transaction.changes.mapPos(positionInEditor(before, comment.to), 1), this.eol),
			}));
		}
		this.changed();
		// A new transaction cannot run inside an editor update listener.
		queueMicrotask(() => {
			if (this.merge.dom.isConnected) {
				this.folds.reset();
				this.showComments();
			}
		});
	}

	setFolding(enabled: boolean): void {
		this.folds.enabled = enabled;
		this.folds.reset();
		this.showComments();
	}

	proposal(): Proposal {
		return { version: 1, text: this.merge.b.state.sliceDoc(), comments: structuredClone(this.comments) };
	}

	selection(): { from: number; to: number } {
		const { from, to } = this.merge.b.state.selection.main;
		const text = this.merge.b.state.doc.toString();
		return { from: positionInFile(text, from, this.eol), to: positionInFile(text, to, this.eol) };
	}

	addComment(comment: Comment): void {
		this.comments.push(comment);
		this.showComments();
		this.changed();
	}

	removeComment(id: string): void {
		this.comments = this.comments.filter(comment => comment.id !== id);
		this.showComments();
		this.changed();
	}

	private editComment(id: string, text: string): void {
		this.comments = this.comments.map(comment => comment.id === id ? { ...comment, text } : comment);
		this.showComments();
		this.changed();
	}

	private showComments(): void {
		const text = this.merge.b.state.sliceDoc();
		const decorations = this.comments.map(comment => comment.from === comment.to
			? Decoration.widget({ widget: new CommentAnchor(comment), side: 1 }).range(positionInEditor(text, comment.from))
			: Decoration.mark({ class: 'proposal-comment-mark', attributes: { 'data-comment-id': comment.id } })
				.range(positionInEditor(text, comment.from), positionInEditor(text, comment.to)));
		this.updating = true;
		try {
			this.merge.b.dispatch({ effects: this.marks.reconfigure(EditorView.decorations.of(Decoration.set(decorations, true))) });
			this.folds.refresh(this.comments.map(comment => ({ from: positionInEditor(text, comment.from), to: positionInEditor(text, comment.to) })));
		}
		finally { this.updating = false; }
	}

	destroy(): void { this.folds.destroy(); this.merge.destroy(); }
}
