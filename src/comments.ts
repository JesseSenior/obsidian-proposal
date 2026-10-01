import type { Comment, TextEdit } from './types';

export function mapComments(comments: Comment[], edit: TextEdit, removeOverlap: boolean) {
	const removed: string[] = [];
	const delta = edit.insert.length - (edit.to - edit.from);
	const map = (position: number, end: boolean): number => {
		if (position < edit.from) return position;
		if (position > edit.to) return position + delta;
		return edit.from + (end ? edit.insert.length : 0);
	};
	const mapped = comments.flatMap(comment => {
		const overlaps = edit.from === edit.to
			? comment.from <= edit.from && edit.from <= comment.to
			: comment.from === comment.to
				? edit.from <= comment.from && comment.from < edit.to
				: edit.from < comment.to && edit.to > comment.from;
		if (removeOverlap && overlaps) {
			removed.push(comment.id);
			return [];
		}
		if (edit.to <= comment.from && !overlaps) {
			return [{ ...comment, from: comment.from + delta, to: comment.to + delta }];
		}
		if (edit.from >= comment.to && !overlaps) return [comment];
		return [{ ...comment, from: map(comment.from, false), to: map(comment.to, true) }];
	});
	return { comments: mapped, removed };
}
