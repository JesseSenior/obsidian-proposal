import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { ProposalStore } from '../src/store';
import { ProposalTools } from '../src/tools';
import type { Snapshot } from '../src/types';
import { MemoryIO } from './memory-io';

interface TestView {
	panel: { empty(): void; createEl(): void };
	title: { setText(): void };
	snapshot?: Snapshot;
	editor?: { destroyed: boolean };
	openFile(path: string): Promise<void>;
	runAction(action: string): Promise<void>;
	refresh(): Promise<void>;
}

// Use the real view actions and store with only Obsidian, the DOM editor, and confirmation replaced.
const bundle = await build({
	entryPoints: ['src/ui/view.ts'], bundle: true, write: false, platform: 'node', format: 'esm',
	define: { window: 'testWindow' }, banner: { js: 'const testWindow = { clearTimeout };' },
	plugins: [{ name: 'view-host', setup(build) {
		build.onResolve({ filter: /^(obsidian|\.\/editor|\.\/modals)$/ }, args => ({ path: args.path, namespace: 'host' }));
		build.onLoad({ filter: /.*/, namespace: 'host' }, args => ({ contents: args.path === 'obsidian'
			? 'export class ItemView { app = {}; } export class Notice {} export function setIcon() {}'
			: args.path === './modals' ? 'export async function confirmAction() { return true; }'
				: `export class ReviewEditor {
					constructor(parent, snapshot) { this.value = structuredClone(snapshot.proposal); this.destroyed = false; }
					proposal() { return structuredClone(this.value); }
					setFolding() {} destroy() { this.destroyed = true; }
				}` }));
	} }],
});
// eslint-disable-next-line no-unsanitized/method -- The bundle contains only local source and fixed test doubles.
const { ProposalView } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0]!.text).toString('base64')}`) as {
	ProposalView: new (leaf: object, tools: ProposalTools, select: () => void) => TestView;
};

for (const action of ['applyCurrent', 'clearCurrent', 'applyAll', 'clearAll']) {
	void test(`${action} removes comments and clears the displayed review`, async () => {
		const io = new MemoryIO();
		const store = new ProposalStore(io);
		for (const path of ['One.md', 'Two.md']) {
			const snapshot = await store.read(path);
			await store.manual(path, snapshot.proposal, path === 'One.md' ? 'new' : snapshot.current,
				[{ id: 'comment', from: 0, to: 1, text: 'Discuss' }]);
		}
		// Include a hidden record left by an older plugin version in all-file actions.
		io.originals.set('Inactive.md', 'same');
		io.files.set('.proposal/Inactive.md.json', JSON.stringify({ version: 1, text: 'same', comments: [] }));
		const view = new ProposalView({}, new ProposalTools(store, () => 2000), () => undefined);
		let emptied = 0;
		view.panel = { empty: () => { emptied++; }, createEl: () => undefined };
		view.title = { setText: () => undefined };
		await view.openFile('One.md');
		const editor = view.editor;
		await view.runAction(action);
		assert.equal(view.snapshot, undefined);
		assert.equal(view.editor, undefined);
		assert.equal(editor?.destroyed, true);
		assert.equal(emptied, 2);
		assert.equal(io.originals.get('One.md'), action.startsWith('apply') ? 'new' : 'old\ncontext\n');
		assert.equal(io.originals.get('Two.md'), 'second\n');
		assert.deepEqual(await store.paths(), action.endsWith('All') ? [] : ['Inactive.md', 'Two.md']);
	});
}

void test('sidebar removal also clears the open review on refresh', async () => {
	const io = new MemoryIO();
	const store = new ProposalStore(io);
	const snapshot = await store.read('One.md');
	await store.manual(snapshot.path, snapshot.proposal, 'new', []);
	const view = new ProposalView({}, new ProposalTools(store, () => 2000), () => undefined);
	view.panel = { empty: () => undefined, createEl: () => undefined };
	view.title = { setText: () => undefined };
	await view.openFile(snapshot.path);
	await store.apply(await store.read(snapshot.path));
	await view.refresh();
	assert.equal(view.editor, undefined);
	assert.equal(view.snapshot, undefined);
});
