import { StateEffect, StateField, type Range } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import type { MergeView } from '@codemirror/merge';

const setFolds = StateEffect.define<DecorationSet>();
const folds = StateField.define<DecorationSet>({
	create: () => Decoration.none,
	update(value, transaction) {
		value = value.map(transaction.changes);
		for (const effect of transaction.effects) if (effect.is(setFolds)) value = effect.value;
		return value;
	},
	provide: field => EditorView.decorations.from(field),
});

type Boundary = 'top' | 'bottom';
interface FoldContext { top: number; bottom: number; expanded?: boolean }

class FoldWidget extends WidgetType {
	constructor(private lines: number, private expand: () => void, private drag: (event: PointerEvent, view: EditorView, boundary: Boundary) => void) { super(); }
	toDOM(view: EditorView): HTMLElement {
		const bar = view.dom.ownerDocument.createElement('div');
		bar.className = 'cm-collapsedLines';
		const label = bar.createEl('button', { cls: 'proposal-fold-label', text: `${this.lines} unchanged lines`, attr: { title: 'Show all unchanged lines' } });
		label.addEventListener('click', this.expand);
		for (const boundary of ['top', 'bottom'] as const) {
			const handle = bar.createDiv({ cls: `proposal-fold-handle proposal-fold-${boundary}`, attr: { title: `Drag the ${boundary} boundary to show more or fewer lines`, role: 'separator', 'aria-label': `${boundary === 'top' ? 'Upper' : 'Lower'} fold boundary`, 'aria-orientation': 'horizontal' } });
			handle.addEventListener('pointerdown', event => this.drag(event, view, boundary));
		}
		return bar;
	}
	ignoreEvent(): boolean { return true; }
}

export class ReviewFolds {
	readonly extension = folds;
	enabled = true;
	private merge!: MergeView;
	private context = new Map<number, FoldContext>();
	private stopDrag?: () => void;
	private comments: { from: number; to: number }[] = [];
	attach(merge: MergeView): void { this.merge = merge; }
	reset(): void { this.stopDrag?.(); this.context.clear(); }
	destroy(): void { this.stopDrag?.(); }

	refresh(comments = this.comments): void {
		this.comments = comments;
		const { a, b, chunks } = this.merge;
		const ranges: Range<Decoration>[][] = [[], []];
		if (this.enabled && chunks.length) for (let index = 0; index <= chunks.length; index++) {
			const previous = chunks[index - 1], next = chunks[index];
			const bounds = [a, b].map((view, side) => {
				const doc = view.state.doc;
				const start = previous ? doc.lineAt(Math.min(doc.length, side ? previous.toB : previous.toA)).number + 3 : 1;
				const end = next ? doc.lineAt(side ? next.fromB : next.fromA).number - 4 : doc.lines;
				return { start, end, doc };
			});
			const count = Math.min(...bounds.map(({ start, end }) => end - start + 1));
			if (count < 6) continue;
			const extra = this.context.get(index) ?? { top: 0, bottom: 0 };
			if (extra.expanded) continue;
			const proposal = bounds[1]!;
			if (comments.some(comment => comment.from <= proposal.doc.line(proposal.end).to && comment.to >= proposal.doc.line(proposal.start).from)) continue;
			bounds.forEach(({ start, end, doc }, side) => {
				const from = start + extra.top;
				const to = end - extra.bottom;
				ranges[side]!.push(Decoration.replace({ block: true, widget: new FoldWidget(to - from + 1, () => {
					this.context.set(index, { ...extra, expanded: true });
					this.refresh();
				}, (event, view, boundary) => this.startDrag(event, view, boundary, index, count, extra)) }).range(doc.line(from).from, doc.line(to).to));
			});
		}
		[a, b].forEach((view, side) => view.dispatch({ effects: setFolds.of(Decoration.set(ranges[side]!)) }));
	}
	private startDrag(event: PointerEvent, view: EditorView, boundary: Boundary, index: number, count: number, initial: FoldContext): void {
		if (event.button !== 0) return;
		event.preventDefault();
		event.stopPropagation();
		this.stopDrag?.();
		const document = view.dom.ownerDocument;
		const window = document.defaultView!;
		const startY = event.clientY;
		const lineHeight = view.defaultLineHeight;
		const startHeight = view.contentHeight;
		const scroller = view.dom.closest<HTMLElement>('.proposal-editors')!;
		const startScroll = scroller.scrollTop;
		const measureKey = {};
		const opposite = boundary === 'top' ? 'bottom' : 'top';
		const move = (moveEvent: PointerEvent) => {
			if (moveEvent.pointerId !== event.pointerId) return;
			moveEvent.preventDefault();
			const delta = Math.round((moveEvent.clientY - startY) / lineHeight) * (boundary === 'top' ? 1 : -1);
			const value = Math.max(0, Math.min(count - initial[opposite] - 1, initial[boundary] + delta));
			this.context.set(index, { ...initial, [boundary]: value });
			this.refresh();
			if (boundary === 'bottom') view.requestMeasure({
				key: measureKey,
				read: () => view.contentHeight,
				write: nextHeight => { scroller.scrollTop = startScroll + nextHeight - startHeight; },
			});
		};
		const stop = () => {
			document.removeEventListener('pointermove', move, true);
			document.removeEventListener('pointerup', stop, true);
			document.removeEventListener('pointercancel', stop, true);
			window.removeEventListener('blur', stop);
			document.body.classList.remove('proposal-fold-dragging');
			this.stopDrag = undefined;
		};
		document.body.classList.add('proposal-fold-dragging');
		document.addEventListener('pointermove', move, { capture: true, passive: false });
		document.addEventListener('pointerup', stop, true);
		document.addEventListener('pointercancel', stop, true);
		window.addEventListener('blur', stop);
		this.stopDrag = stop;
	}

}
