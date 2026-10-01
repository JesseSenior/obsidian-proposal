import { Chunk } from '@codemirror/merge';
import { Text } from '@codemirror/state';

export function difference(current: string, proposal: string) {
	const a = Text.of(current.split('\n'));
	const b = Text.of(proposal.split('\n'));
	const chunks = Chunk.build(a, b, { timeout: 1000 });
	const count = (doc: Text, from: number, to: number) => from === to ? 0 :
		doc.lineAt(Math.min(to - 1, doc.length)).number - doc.lineAt(from).number + 1;
	return {
		added: chunks.reduce((sum, chunk) => sum + count(b, chunk.fromB, chunk.toB), 0),
		deleted: chunks.reduce((sum, chunk) => sum + count(a, chunk.fromA, chunk.toA), 0),
		hunks: chunks.map(chunk => ({
			current: { startLine: a.lineAt(chunk.fromA).number, text: current.slice(chunk.fromA, chunk.toA) },
			proposal: { startLine: b.lineAt(chunk.fromB).number, text: proposal.slice(chunk.fromB, chunk.toB) },
		})),
	};
}
