import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ProposalStore, validatePath } from '../src/store';
import { ProposalTools } from '../src/tools';
import { MemoryIO } from './memory-io';


const fixture = () => {
	const io = new MemoryIO();
	const store = new ProposalStore(io);
	return { io, store, tools: new ProposalTools(store, () => 2000) };
};
const patch = (body: string) => `*** Begin Patch\n${body}\n*** End Patch`;

void test('read falls back to original without creating a proposal', async () => {
	const { tools, io } = fixture();
	assert.equal((await tools.read({ path: 'One.md' })).text, 'old\ncontext\n');
	assert.equal(io.files.size, 0);
});

void test('per-file failure leaves all blocks unchanged and other files succeed', async () => {
	const { tools, io } = fixture();
	const result = await tools.edit({ patch: patch('*** Update File: One.md\n@@\n-old\n+new\n@@\n-missing\n+bad\n*** Update File: Two.md\n@@\n-second\n+changed') });
	assert.deepEqual(result.files.map(file => file.ok), [false, true]);
	assert.equal(io.files.has('.proposal/One.md.json'), false);
	assert.equal((await tools.read({ path: 'Two.md' })).text, 'changed\n');
	assert.equal(io.originals.get('Two.md'), 'second\n');
});

void test('comments survive restart, context comments survive tool edits, overlaps are reported', async () => {
	const { store, tools, io } = fixture();
	const before = await store.read('One.md');
	await store.manual('One.md', before.proposal, before.proposal.text, [
		{ id: 'old', from: 0, to: 3, text: 'Change' }, { id: 'context', from: 4, to: 11, text: 'Keep' },
	]);
	const result = await tools.edit({ patch: patch('*** Update File: One.md\n@@\n-old\n+longer\n context') });
	assert.deepEqual(result.files[0]?.removedCommentIds, ['old']);
	const reloaded = await new ProposalStore(io).read('One.md');
	assert.deepEqual(reloaded.proposal.comments, [{ id: 'context', from: 7, to: 14, text: 'Keep' }]);
	assert.equal(reloaded.proposal.text, 'longer\ncontext\n');
});

void test('manual save detects stale proposal and operations serialize', async () => {
	const { store } = fixture();
	const snapshot = await store.read('One.md');
	const results = await Promise.allSettled([
		store.manual('One.md', snapshot.proposal, 'first', []),
		store.manual('One.md', snapshot.proposal, 'second', []),
	]);
	assert.equal(results[0]?.status, 'fulfilled');
	assert.equal(results[1]?.status, 'rejected');
	assert.equal((await store.read('One.md')).proposal.text, 'first');
});

void test('file apply removes the proposal and comments and cannot reappear after note edits', async () => {
	const { store, io } = fixture();
	const before = await store.read('One.md');
	await store.manual('One.md', before.proposal, 'new', [{ id: 'a', from: 0, to: 3, text: 'Discuss' }]);
	await store.apply(await store.read('One.md'));
	assert.equal(io.originals.get('One.md'), 'new');
	assert.equal(io.files.size, 0);
	assert.equal((await store.active()).length, 0);
	io.originals.set('One.md', 'later edit');
	assert.equal((await store.active()).length, 0);
	assert.equal((await store.read('One.md')).proposal.text, 'later edit');
});

void test('clear removes comments and preserves the original', async () => {
	const { store, io } = fixture();
	const before = await store.read('One.md');
	await store.manual('One.md', before.proposal, 'new', [{ id: 'a', from: 0, to: 3, text: 'Discuss' }]);
	await store.clear('One.md');
	assert.equal(io.files.size, 0);
	assert.equal(io.originals.get('One.md'), before.current);
});

void test('file apply removes comment-only and inactive proposals', async () => {
	for (const comments of [[], [{ id: 'a', from: 0, to: 3, text: 'Discuss' }]]) {
		const { store, io } = fixture();
		const before = await store.read('One.md');
		await store.manual('One.md', before.proposal, before.current, comments);
		await store.apply(await store.read('One.md'));
		assert.equal(io.files.size, 0);
		assert.equal(io.originals.get('One.md'), before.current);
	}
});

void test('applying a single change preserves the remaining proposal and comments', async () => {
	const { store, io } = fixture();
	const before = await store.read('One.md');
	const comments = [{ id: 'a', from: 0, to: 3, text: 'Discuss' }];
	await store.manual('One.md', before.proposal, 'new\nchanged\n', comments);
	await store.apply(await store.read('One.md'), 'new\ncontext\n');
	assert.equal(io.originals.get('One.md'), 'new\ncontext\n');
	assert.deepEqual((await store.read('One.md')).proposal, { version: 1, text: 'new\nchanged\n', comments });
});

void test('failed apply preserves the proposal and comments', async () => {
	const { store, io } = fixture();
	const before = await store.read('One.md');
	await store.manual('One.md', before.proposal, 'new', [{ id: 'a', from: 0, to: 3, text: 'Discuss' }]);
	const stored = io.files.get('.proposal/One.md.json');
	io.writeCurrent = () => Promise.reject(new Error('Write failed'));
	await assert.rejects(store.apply(await store.read('One.md')), /Write failed/);
	assert.equal(io.files.get('.proposal/One.md.json'), stored);
});

void test('stale original or proposal cannot be applied', async () => {
	const { store, io } = fixture();
	const before = await store.read('One.md');
	await store.manual('One.md', before.proposal, 'new', []);
	const snapshot = await store.read('One.md');
	io.originals.set('One.md', 'outside edit');
	await assert.rejects(store.apply(snapshot), /Text changed/);
	assert.equal(io.originals.get('One.md'), 'outside edit');
	const latest = await store.read('One.md');
	await store.manual('One.md', latest.proposal, 'another proposal', []);
	await assert.rejects(store.apply(latest), /Text changed/);
});

void test('tools flush editor changes before reading and writing', async () => {
	const { store, tools } = fixture();
	tools.flushers.add(async () => {
		const snapshot = await store.read('One.md');
		await store.manual('One.md', snapshot.proposal, 'flushed\n', []);
	});
	assert.equal((await tools.read({ path: 'One.md' })).text, 'flushed\n');
});

void test('paths cannot escape the vault or target hidden/configuration files', () => {
	for (const path of ['../One.md', '/One.md', 'a/../One.md', '.proposal/One.md', '.private/One.md', 'a\\One.md', 'C:/One.md', 'One.txt', 'a//One.md', 'settings/One.md']) {
		assert.throws(() => validatePath(path, 'settings'));
	}
	assert.equal(validatePath('草稿/笔记.md', 'config'), '草稿/笔记.md');
});
