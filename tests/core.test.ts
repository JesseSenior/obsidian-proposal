import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyPatch, parsePatch } from '../src/patch';
import { mapComments } from '../src/comments';
import { readResult } from '../src/read';
import { difference } from '../src/diff';

const patch = (body: string) => parsePatch(`*** Begin Patch\n*** Update File: Note.md\n${body}\n*** End Patch`)[0]!;

void test('patch applies multiple blocks and preserves context', () => {
	const result = applyPatch('Heading\nold\nkeep\nend\n', patch('@@\n Heading\n-old\n+new\n@@\n-end\n+finish'));
	assert.equal(result.text, 'Heading\nnew\nkeep\nfinish\n');
	assert.equal(result.edits.length, 2);
});

void test('patch rejects missing and ambiguous context', () => {
	assert.throws(() => applyPatch('same\nsame\n', patch('@@\n-same\n+new')), /ambiguous/);
	assert.throws(() => applyPatch('different', patch('@@\n-same\n+new')), /does not match/);
});

void test('heading anchors and EOF markers select exact contexts', () => {
	assert.equal(applyPatch('same\n# Next\nsame\n', patch('@@ # Next\n-same\n+new')).text, 'same\n# Next\nnew\n');
	assert.equal(applyPatch('same\nsame', patch('@@\n-same\n+new\n*** End of File')).text, 'same\nnew');
});

void test('patch keeps Unicode and CRLF line endings', () => {
	assert.equal(applyPatch('# 标题\r\n旧内容\r\n', patch('@@\n-旧内容\n+新内容')).text, '# 标题\r\n新内容\r\n');
});

void test('patch preserves missing terminal newline and deletes the last line', () => {
	assert.equal(applyPatch('one\ntwo', patch('@@\n-two\n+three')).text, 'one\nthree');
	assert.equal(applyPatch('one\ntwo', patch('@@\n-two')).text, 'one');
	assert.equal(applyPatch('one\ntwo\n', patch('@@\n-two')).text, 'one\n');
});

void test('patch inserts before and after context', () => {
	assert.equal(applyPatch('one\ntwo\n', patch('@@\n one\n+middle\n two')).text, 'one\nmiddle\ntwo\n');
	assert.equal(applyPatch('one', patch('@@\n one\n+two')).text, 'one\ntwo');
});

void test('unsupported patch operations fail', () => {
	assert.throws(() => parsePatch('*** Begin Patch\n*** Add File: New.md\n+text\n*** End Patch'), /Only Update/);
	assert.throws(() => applyPatch('old', patch('*** Move to: New.md\n@@\n-old\n+new')), /Renaming/);
});

void test('tool edits remove overlaps and move other comments', () => {
	const result = mapComments([
		{ id: 'overlap', from: 2, to: 5, text: 'Change this' },
		{ id: 'after', from: 8, to: 10, text: 'Keep this' },
	], { from: 2, to: 5, insert: 'x' }, true);
	assert.deepEqual(result.removed, ['overlap']);
	assert.deepEqual(result.comments, [{ id: 'after', from: 6, to: 8, text: 'Keep this' }]);
});

void test('manual deletion keeps an empty comment anchor', () => {
	const result = mapComments([{ id: 'a', from: 2, to: 5, text: 'Keep' }], { from: 1, to: 6, insert: '' }, false);
	assert.deepEqual(result.comments, [{ id: 'a', from: 1, to: 1, text: 'Keep' }]);
});

void test('read returns full text, inclusive sections, and outlines at the word limit', () => {
	const snapshot = { path: 'Note.md', current: '', proposal: { version: 1 as const, text: '# Title\nhello world\n## Next\nmore text', comments: [] } };
	assert.equal(readResult(snapshot, { path: 'Note.md' }, 2000).text, snapshot.proposal.text);
	assert.equal(readResult(snapshot, { path: 'Note.md', startLine: 2, endLine: 2 }, 1).text, 'hello world');
	const large = readResult(snapshot, { path: 'Note.md' }, 2);
	assert.equal(large.text, undefined);
	assert.deepEqual('outline' in large ? large.outline : null, [
		{ title: 'Title', level: 1, startLine: 1, endLine: 4 },
		{ title: 'Next', level: 2, startLine: 3, endLine: 4 },
	]);
	assert.throws(() => readResult(snapshot, { path: 'Note.md', startLine: 0 }, 2), /Line range/);
});

void test('read counts Chinese words and ignores fenced headings', () => {
	const snapshot = { path: 'Note.md', current: '', proposal: { version: 1 as const, text: '高效使用笔记管理内容\n```\n# hidden\n```', comments: [] } };
	const result = readResult(snapshot, { path: 'Note.md' }, 1);
	assert.ok(result.words !== undefined && result.words > 1);
	assert.deepEqual('outline' in result ? result.outline : null, []);
});

void test('line counts cover additions, deletions, and replacements', () => {
	assert.equal(difference('one\n', 'one\ntwo\n').added, 1);
	assert.equal(difference('one\ntwo\n', 'one\n').deleted, 1);
	assert.equal(difference('one\n', 'two\n').added, 1);
	assert.equal(difference('one\n', 'two\n').deleted, 1);
});
