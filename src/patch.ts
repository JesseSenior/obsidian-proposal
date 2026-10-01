import type { TextEdit } from './types';

interface Block { anchor?: string; lines: string[]; eof: boolean }
export interface FilePatch { path: string; blocks: Block[]; error?: string }

export function parsePatch(patch: string): FilePatch[] {
	const lines = patch.replace(/\r\n/g, '\n').split('\n');
	if (lines.at(-1) === '') lines.pop();
	if (lines.shift() !== '*** Begin Patch' || lines.pop() !== '*** End Patch') {
		throw new Error('Patch must start with *** Begin Patch and end with *** End Patch.');
	}
	const files: FilePatch[] = [];
	let file: FilePatch | undefined;
	let block: Block | undefined;
	for (const line of lines) {
		if (line.startsWith('*** Update File: ')) {
			file = { path: line.slice(17), blocks: [] };
			files.push(file);
			block = undefined;
		} else if (line.startsWith('*** Add File: ') || line.startsWith('*** Delete File: ')) {
			throw new Error('Only Update File patches are supported.');
		} else if (!file) {
			throw new Error('Expected *** Update File: <vault-relative path>.');
		} else if (line.startsWith('*** Move to: ')) {
			file.error = 'Renaming files is not supported.';
		} else if (line === '@@' || line.startsWith('@@ ')) {
			block = { anchor: line.length > 3 ? line.slice(3) : undefined, lines: [], eof: false };
			file.blocks.push(block);
		} else if (line === '*** End of File' && block) {
			block.eof = true;
		} else if (/^[ +-]/.test(line)) {
			if (!block) {
				block = { lines: [], eof: false };
				file.blocks.push(block);
			}
			block.lines.push(line);
		} else {
			file.error = `Unsupported patch line: ${line}`;
		}
	}
	if (!files.length) throw new Error('Patch contains no file updates.');
	return files;
}

export function applyPatch(text: string, patch: FilePatch): { text: string; edits: TextEdit[] } {
	if (patch.error) throw new Error(patch.error);
	if (!patch.blocks.length) throw new Error('File update contains no blocks.');
	const eol = text.includes('\r\n') ? '\r\n' : '\n';
	let cursor = 0;
	const edits: TextEdit[] = [];
	for (const block of patch.blocks) {
		const source = text ? text.split(eol) : [];
		const terminalNewline = source.at(-1) === '';
		if (terminalNewline) source.pop();
		let start = cursor;
		if (block.anchor) {
			const anchor = source.indexOf(block.anchor, start);
			if (anchor < 0) throw new Error(`Context not found: ${block.anchor}`);
			start = anchor + 1;
		}
		const oldLines = block.lines.filter(line => line[0] !== '+').map(line => line.slice(1));
		const newLines = block.lines.filter(line => line[0] !== '-').map(line => line.slice(1));
		const matches: number[] = [];
		for (let index = start; index <= source.length - oldLines.length; index++) {
			if (oldLines.every((line, offset) => source[index + offset] === line) &&
				(!block.eof || index + oldLines.length === source.length)) matches.push(index);
		}
		if (matches.length !== 1) throw new Error(matches.length ? 'Patch context is ambiguous.' : 'Patch context does not match.');
		const index = matches[0]!;
		// Convert only changed runs to edits, so context lines retain their comments.
		let lineIndex = index;
		let runStart = -1;
		let deleted = 0;
		let inserted: string[] = [];
		const runs: { line: number; deleted: number; inserted: string[] }[] = [];
		const finish = () => {
			if (runStart >= 0) runs.push({ line: runStart, deleted, inserted });
			runStart = -1; deleted = 0; inserted = [];
		};
		for (const line of block.lines) {
			if (line[0] === ' ') { finish(); lineIndex++; }
			else {
				if (runStart < 0) runStart = lineIndex;
				if (line[0] === '-') { deleted++; lineIndex++; }
				else inserted.push(line.slice(1));
			}
		}
		finish();
		for (const run of runs.reverse()) {
			const offset = (line: number) => source.slice(0, line).reduce((sum, value) => sum + value.length + eol.length, 0);
			let from = Math.min(offset(run.line), text.length);
			const to = Math.min(offset(run.line + run.deleted), text.length);
			const reachesEnd = run.line + run.deleted === source.length;
			let insert = run.inserted.join(eol);
			if (run.inserted.length && (!reachesEnd || terminalNewline)) insert += eol;
			if (run.line === source.length && !terminalNewline && source.length && insert) insert = eol + insert;
			if (reachesEnd && !terminalNewline && !insert && from > 0) from -= eol.length;
			const edit = { from, to, insert };
			text = text.slice(0, from) + insert + text.slice(to);
			edits.push(edit);
		}
		cursor = index + newLines.length;
	}
	return { text, edits };
}
