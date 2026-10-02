import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ProposalStore } from '../src/store';
import { MemoryIO } from './memory-io';

const record = (text: string) => JSON.stringify({ version: 1, text, comments: [{ id: 'a', from: 0, to: 1, text: 'Keep' }] });
const key = (path: string) => `.proposal/${path}.json`;
const move = (io: MemoryIO, oldPath: string, newPath: string) => {
	io.originals.set(newPath, io.originals.get(oldPath)!);
	io.originals.delete(oldPath);
};

void test('missing originals are cleaned without blocking valid proposals', async () => {
	const io = new MemoryIO();
	io.files.set(key('Missing.md'), record('missing'));
	io.files.set(key('One.md'), record('keep'));
	const store = new ProposalStore(io);
	assert.deepEqual((await store.active()).map(s => s.path), ['One.md']);
	assert.equal(io.files.has(key('Missing.md')), false);
	assert.equal(io.files.get(key('One.md')), record('keep'));
	assert.equal(io.originals.get('One.md'), 'old\ncontext\n');
});

void test('startup cleanup waits for readiness and notifies previously empty views', async () => {
	const io = new MemoryIO();
	io.files.set(key('Missing.md'), record('missing'));
	const store = new ProposalStore(io, false);
	assert.deepEqual(await store.active(), []);
	assert.equal(io.files.has(key('Missing.md')), true);
	let updates = 0;
	store.subscribe(() => { updates++; });
	await store.start();
	assert.equal(io.files.has(key('Missing.md')), false);
	assert.ok(updates > 0);
	const empty = new ProposalStore(io, false);
	let ready = false;
	empty.subscribe(() => { ready = true; });
	await empty.start();
	assert.equal(ready, true);
});

void test('read errors, existence errors, and invalid JSON do not remove proposals', async () => {
	for (const failure of ['read', 'exists', 'json']) {
		const io = new MemoryIO();
		const raw = failure === 'json' ? '{bad' : record('keep');
		io.files.set(key('One.md'), raw);
		if (failure === 'read') io.readCurrent = () => Promise.reject(new Error('Permission denied'));
		if (failure === 'exists') io.originalExists = () => Promise.reject(new Error('Disk unavailable'));
		await assert.rejects(new ProposalStore(io).active());
		assert.equal(io.files.get(key('One.md')), raw);
	}
});

void test('rename preserves raw proposal and comments and replaces the target proposal', async () => {
	const io = new MemoryIO();
	io.files.set(key('One.md'), record('incoming'));
	io.files.set(key('Renamed.md'), record('stale'));
	move(io, 'One.md', 'Renamed.md');
	const store = new ProposalStore(io);
	await store.changePath({ oldPath: 'One.md', newPath: 'Renamed.md', folder: false });
	assert.equal(io.files.has(key('One.md')), false);
	assert.equal(io.files.get(key('Renamed.md')), record('incoming'));
	assert.equal((await store.active())[0]?.path, 'Renamed.md');
});

void test('nested folder moves and deletes respect directory boundaries', async () => {
	const io = new MemoryIO();
	for (const path of ['Folder/A.md', 'Folder/Nested/B.md', 'Folder-extra/C.md']) {
		io.originals.set(path, 'original');
		io.files.set(key(path), record(path));
	}
	move(io, 'Folder/A.md', 'Moved/A.md');
	move(io, 'Folder/Nested/B.md', 'Moved/Nested/B.md');
	const store = new ProposalStore(io);
	await store.changePath({ oldPath: 'Folder', newPath: 'Moved', folder: true });
	assert.equal(io.files.get(key('Moved/Nested/B.md')), record('Folder/Nested/B.md'));
	assert.equal(io.files.get(key('Folder-extra/C.md')), record('Folder-extra/C.md'));
	await store.changePath({ oldPath: 'Moved', folder: true });
	assert.deepEqual([...io.files.keys()], [key('Folder-extra/C.md')]);
});

void test('failed folder migration preserves all remaining source records during refresh', async () => {
	const io = new MemoryIO();
	io.files.set(key('Folder/A.md'), record('a'));
	io.files.set(key('Folder/B.md'), record('b'));
	io.write = () => Promise.reject(new Error('Disk full'));
	const store = new ProposalStore(io);
	await assert.rejects(store.changePath({ oldPath: 'Folder', newPath: 'Moved', folder: true }), /Disk full/);
	await store.active();
	assert.equal(io.files.get(key('Folder/A.md')), record('a'));
	assert.equal(io.files.get(key('Folder/B.md')), record('b'));
});

void test('a queued save before rename is migrated and a later save uses the destination', async () => {
	const io = new MemoryIO();
	const store = new ProposalStore(io);
	const snapshot = await store.read('One.md');
	const saving = store.manual('One.md', snapshot.proposal, 'saved', []);
	move(io, 'One.md', 'Renamed.md');
	const renaming = store.changePath({ oldPath: 'One.md', newPath: 'Renamed.md', folder: false });
	await Promise.all([saving, renaming]);
	const renamed = await store.read('Renamed.md');
	assert.equal(renamed.proposal.text, 'saved');
	await store.manual('Renamed.md', renamed.proposal, 'later', []);
	assert.equal((await store.read('Renamed.md')).proposal.text, 'later');
	assert.equal(io.files.has(key('One.md')), false);
});

void test('rename during an in-flight read retries at the new path without deleting the proposal', async () => {
	const io = new MemoryIO();
	io.files.set(key('One.md'), record('keep'));
	const read = io.readCurrent.bind(io);
	let release!: () => void;
	let entered!: () => void;
	const started = new Promise<void>(resolve => { entered = resolve; });
	const blocked = new Promise<void>(resolve => { release = resolve; });
	io.readCurrent = async path => {
		if (path === 'One.md') { entered(); await blocked; }
		return read(path);
	};
	const store = new ProposalStore(io);
	const refreshing = store.active();
	await started;
	move(io, 'One.md', 'Renamed.md');
	const renaming = store.changePath({ oldPath: 'One.md', newPath: 'Renamed.md', folder: false });
	release();
	await Promise.all([refreshing, renaming]);
	assert.equal(io.files.get(key('Renamed.md')), record('keep'));
});

void test('rapid consecutive moves serialize and cleanup waits for both', async () => {
	const io = new MemoryIO();
	io.files.set(key('One.md'), record('keep'));
	const store = new ProposalStore(io);
	move(io, 'One.md', 'Middle.md');
	const first = store.changePath({ oldPath: 'One.md', newPath: 'Middle.md', folder: false });
	const refresh = store.active();
	move(io, 'Middle.md', 'Last.md');
	const second = store.changePath({ oldPath: 'Middle.md', newPath: 'Last.md', folder: false });
	await Promise.all([first, refresh, second]);
	assert.deepEqual([...io.files.keys()], [key('Last.md')]);
	assert.equal(io.files.get(key('Last.md')), record('keep'));
});

void test('delete during a queued save cannot recreate the proposal', async () => {
	const io = new MemoryIO();
	const store = new ProposalStore(io);
	const snapshot = await store.read('One.md');
	io.files.set(key('One.md'), record('keep'));
	const saving = store.manual('One.md', snapshot.proposal, 'unsaved', []);
	io.originals.delete('One.md');
	const deleting = store.changePath({ oldPath: 'One.md', folder: false });
	await assert.rejects(saving, /Markdown note not found/);
	await deleting;
	assert.equal(io.files.has(key('One.md')), false);
});

void test('rename and delete wait for an in-flight proposal write', async () => {
	for (const newPath of ['Renamed.md', undefined]) {
		const io = new MemoryIO();
		const store = new ProposalStore(io);
		const snapshot = await store.read('One.md');
		const write = io.write.bind(io);
		let entered!: () => void;
		let release!: () => void;
		const started = new Promise<void>(resolve => { entered = resolve; });
		const blocked = new Promise<void>(resolve => { release = resolve; });
		io.write = async (path, text) => { entered(); await blocked; await write(path, text); };
		const saving = store.manual('One.md', snapshot.proposal, 'in flight', []);
		await started;
		if (newPath) move(io, 'One.md', newPath);
		else io.originals.delete('One.md');
		const changing = store.changePath({ oldPath: 'One.md', newPath, folder: false });
		release();
		await Promise.all([saving, changing]);
		assert.equal(io.files.has(key('One.md')), false);
		if (newPath) assert.equal((await store.read(newPath)).proposal.text, 'in flight');
		else assert.equal(io.files.size, 0);
	}
});

void test('queued clear after a rename removes the destination proposal', async () => {
	const io = new MemoryIO();
	io.files.set(key('One.md'), record('keep'));
	const store = new ProposalStore(io);
	move(io, 'One.md', 'Renamed.md');
	await Promise.all([
		store.changePath({ oldPath: 'One.md', newPath: 'Renamed.md', folder: false }),
		store.clear('Renamed.md'),
	]);
	assert.equal(io.files.size, 0);
});

void test('moves outside supported Markdown paths remove the old proposal', async () => {
	for (const newPath of ['One.txt', '.hidden/One.md', 'config/One.md']) {
		const io = new MemoryIO();
		io.files.set(key('One.md'), record('keep'));
		const store = new ProposalStore(io);
		await store.changePath({ oldPath: 'One.md', newPath, folder: false });
		assert.equal(io.files.size, 0);
	}
});
