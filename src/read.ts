import type { ReadRequest, Snapshot } from './types';

interface ReadResult {
	path: string;
	comments: Snapshot['proposal']['comments'];
	totalLines: number;
	text?: string;
	words?: number;
	startLine?: number;
	endLine?: number;
	outline?: { title: string; level: number; startLine: number; endLine: number }[];
	instruction?: string;
	suggestedRange?: { startLine: number; endLine: number };
}

export function readResult(snapshot: Snapshot, request: ReadRequest, limit: number): ReadResult {
	const { path, proposal } = snapshot;
	const lines = proposal.text.split('\n');
	const result = { path, comments: proposal.comments, totalLines: lines.length };
	if (request.startLine !== undefined || request.endLine !== undefined) {
		const start = request.startLine ?? 1;
		const end = request.endLine ?? lines.length;
		if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > lines.length) {
			throw new Error(`Line range must be within 1–${lines.length}.`);
		}
		return { ...result, startLine: start, endLine: end, text: lines.slice(start - 1, end).join('\n') };
	}
	const words = [...new Intl.Segmenter(undefined, { granularity: 'word' }).segment(proposal.text)]
		.filter(segment => segment.isWordLike).length;
	if (words < limit) return { ...result, words, text: proposal.text };
	const headings: { title: string; level: number; startLine: number; endLine: number }[] = [];
	let fence = '';
	lines.forEach((line, index) => {
		const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
		if (marker) { if (!fence) fence = marker; else if (marker[0] === fence[0] && marker.length >= fence.length) fence = ''; return; }
		if (fence) return;
		const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
		if (match) headings.push({ title: match[2]!, level: match[1]!.length, startLine: index + 1, endLine: lines.length });
	});
	headings.forEach((heading, index) => {
		const next = headings.slice(index + 1).find(candidate => candidate.level <= heading.level);
		heading.endLine = next ? next.startLine - 1 : lines.length;
	});
	return { ...result, words, outline: headings, instruction: 'Read a section with startLine and endLine (inclusive).',
		...(!headings.length ? { suggestedRange: { startLine: 1, endLine: Math.min(100, lines.length) } } : {}) };
}
