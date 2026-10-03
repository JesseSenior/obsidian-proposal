import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
import { test } from 'node:test';

const vault = process.argv[2];
if (!vault?.startsWith('proposal-smoke-')) throw new Error('Supply a disposable proposal-smoke-* vault name.');

function cli(...args: string[]): string {
	return execFileSync('obsidian', [`vault=${vault}`, ...args], { encoding: 'utf8', timeout: 15000 });
}

function query<T>(expression: string): T {
	const output = cli('eval', `code=JSON.stringify(${expression})`);
	const line = output.split('\n').find(value => value.startsWith('=> '));
	if (!line) throw new Error(`No CLI result: ${output}`);
	return JSON.parse(line.slice(3)) as T;
}

async function run<T = unknown>(body: string): Promise<T> {
	cli('eval', `code=window.__proposalSmoke={pending:true};void (async()=>{const p=app.plugins.getPlugin("proposal");const v=app.workspace.getLeavesOfType("proposal-review")[0]?.view;${body}})().then(result=>{window.__proposalSmoke={result}},error=>{window.__proposalSmoke={error:String(error)}});"queued"`);
	for (let attempt = 0; attempt < 40; attempt++) {
		const status = query<{ pending?: boolean; error?: string; result: T }>('window.__proposalSmoke');
		if (status.error) throw new Error(status.error);
		if (!status.pending) return status.result;
		await setTimeout(Math.min(25 * 2 ** attempt, 250));
	}
	throw new Error('Obsidian operation timed out.');
}

async function until(body: string): Promise<void> {
	for (let attempt = 0; attempt < 30; attempt++) {
		if (await run<boolean>(body)) return;
		await setTimeout(Math.min(25 * 2 ** attempt, 250));
	}
	throw new Error(`Condition did not become true: ${body}`);
}

void test('Obsidian CLI, review, comments, apply, clear, URL, and unload', { timeout: 120000 }, async () => {
	const location = query<{ name: string; path: string }>('({name:app.vault.getName(),path:app.vault.adapter.getBasePath()})');
	assert.equal(location.name, vault);
	assert.match(location.path, /^\/(?:private\/)?tmp\/proposal-smoke-/);
	assert.equal(query<boolean>('!!app.plugins.getPlugin("proposal")'), true);
	const original = '# Review\n\nOriginal sentence.\n\n' + Array.from({ length: 30 }, (_, i) => `Unchanged line ${i + 1}.\n`).join('') + '\nLast sentence.\n';
	await run(`await p.tools.flush();for(const path of await p.tools.store.paths()) await p.tools.store.clear(path);
		if(!app.vault.getAbstractFileByPath("Smoke")) await app.vault.createFolder("Smoke");
		for(const [path,text] of [["Smoke/Review.md",${JSON.stringify(original)}],["Smoke/Other.md","Other note.\\n"]]) {
			const file=app.vault.getAbstractFileByPath(path);if(file)await app.vault.modify(file,text);else await app.vault.create(path,text);
		} return true;`);
	const read = await run<{ ok: boolean; result: { text: string } }>('return await p.proposal_read({path:"Smoke/Review.md"});');
	assert.equal(read.ok, true);
	assert.equal(read.result.text, original);
	assert.equal(await run('return await app.vault.adapter.exists(".proposal/Smoke/Review.md.json");'), false);
	await run('await app.workspace.getLeaf("tab").openFile(app.vault.getAbstractFileByPath("Smoke/Review.md"));return true;');
	assert.equal(query<boolean>('!!document.querySelector(".proposal-status").getClientRects().length'), true);
	await run('await app.workspace.getMostRecentLeaf().setViewState({type:"empty",active:true});return true;');
	assert.equal(query<boolean>('!!document.querySelector(".proposal-status").getClientRects().length'), false);
	await run('await app.workspace.revealLeaf(app.workspace.getLeavesOfType("file-explorer")[0]);return true;');
	await run('await p.openReview("Smoke/Review.md");return true;');
	assert.equal(query<boolean>('document.querySelector(".proposal-editors").textContent.includes("unchanged lines")'), false);
	await until('return app.workspace.getLeavesOfType("proposal-files").length===1;');
	assert.equal(await run('return app.workspace.getMostRecentLeaf(app.workspace.leftSplit)?.view.getViewType();'), 'proposal-files');
	await run('const s=await p.tools.store.read("Smoke/Review.md");await p.tools.store.manual(s.path,s.proposal,s.proposal.text,[{id:"sidebar-check",from:0,to:1,text:"Check visibility"}]);return true;');
	await until('return app.workspace.getMostRecentLeaf(app.workspace.leftSplit)?.view.getViewType()==="proposal-files";');
	await run('await app.workspace.getLeaf("tab").openFile(app.vault.getAbstractFileByPath("Smoke/Review.md"));return true;');
	await until('return app.workspace.getMostRecentLeaf(app.workspace.leftSplit)?.view.getViewType()==="file-explorer";');
	await run('await app.workspace.revealLeaf(app.workspace.getLeavesOfType("bookmarks")[0]);await p.openReview("Smoke/Review.md");return true;');
	await until('return app.workspace.getMostRecentLeaf(app.workspace.leftSplit)?.view.getViewType()==="proposal-files";');
	await run('app.workspace.setActiveLeaf(app.workspace.getLeavesOfType("markdown")[0],{focus:false});return true;');
	await until('return app.workspace.getMostRecentLeaf(app.workspace.leftSplit)?.view.getViewType()==="bookmarks";');
	await run('await app.workspace.revealLeaf(app.workspace.getLeavesOfType("file-explorer")[0]);await p.openReview("Smoke/Review.md");return true;');
	await until('return app.workspace.getMostRecentLeaf(app.workspace.leftSplit)?.view.getViewType()==="proposal-files";');
	await run('await app.workspace.revealLeaf(app.workspace.getLeavesOfType("bookmarks")[0]);app.workspace.setActiveLeaf(app.workspace.getLeavesOfType("markdown")[0],{focus:false});return true;');
	await until('return app.workspace.getMostRecentLeaf(app.workspace.leftSplit)?.view.getViewType()==="bookmarks";');
	await run('await app.workspace.revealLeaf(app.workspace.getLeavesOfType("proposal-files")[0]);await p.openReview("Smoke/Review.md");return true;');
	await until('return app.workspace.getMostRecentLeaf(app.workspace.leftSplit)?.view.getViewType()==="proposal-files";');
	await run('app.workspace.setActiveLeaf(app.workspace.getLeavesOfType("markdown")[0],{focus:false});return true;');
	await until('return app.workspace.getMostRecentLeaf(app.workspace.leftSplit)?.view.getViewType()==="file-explorer";');
	await run('await p.openReview("Smoke/Review.md");return true;');
	await run('return await p.proposal_edit({removeComments:{"Smoke/Review.md":["sidebar-check"]}});');
	await until('return app.workspace.getLeavesOfType("proposal-files").length===1;');
	await run('v.editor.merge.b.dispatch({changes:{from:0,insert:"Temporary change\\n"}});return true;');
	await until('return document.querySelector(".proposal-editors").textContent.includes("unchanged lines");');
	await run('const editor=v.editor.merge.b;editor.dispatch({changes:{from:0,to:editor.state.doc.length,insert:v.snapshot.current}});return true;');
	await until('return !document.querySelector(".proposal-editors").textContent.includes("unchanged lines");');
	const patch = '*** Begin Patch\n*** Update File: Smoke/Review.md\n@@\n-Original sentence.\n+Proposed sentence.\n*** Update File: Smoke/Other.md\n@@\n-missing\n+not saved\n*** End Patch';
	const edited = await run<{ result: { files: { ok: boolean }[] } }>(`return await p.proposal_edit({patch:${JSON.stringify(patch)}});`);
	assert.deepEqual(edited.result.files.map(file => file.ok), [true, false]);
	await run('await p.openReview("Smoke/Review.md");return true;');
	assert.equal(query<boolean>('!!document.querySelector(".proposal-status").getClientRects().length'), false);
	assert.equal(query<number>('document.querySelectorAll(".proposal-status").length'), 1);
	assert.equal(query<boolean>('document.querySelector(".proposal-status").nextElementSibling.classList.contains("plugin-editor-status")'), true);
	assert.equal(query<number>('document.querySelectorAll(".proposal-view .cm-editor").length'), 2);
	assert.equal(await run('return v.editor.merge.a.state.readOnly;'), true);
	assert.equal(query<boolean>('document.querySelector(".proposal-editors").textContent.includes("unchanged lines")'), true);
	await until('return !!document.querySelector(".proposal-file-toggle");');
	const foldedCount = query<number>('parseInt(document.querySelector(".cm-collapsedLines").textContent)');
	const dragFold = async (boundary: string, lines: number) => run(`
		const handle=document.querySelector(".proposal-fold-${boundary}");const y=handle.getBoundingClientRect().top;
		handle.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,button:0,pointerId:41,clientY:y}));
		document.dispatchEvent(new PointerEvent("pointermove",{bubbles:true,cancelable:true,pointerId:41,clientY:y+${lines}*v.editor.merge.a.defaultLineHeight}));
		document.dispatchEvent(new PointerEvent("pointerup",{bubbles:true,pointerId:41}));return true;`);
	for (const boundary of ['top', 'bottom']) {
		await dragFold(boundary, boundary==='top'?3:-3);
		assert.equal(query<number>('parseInt(document.querySelector(".cm-collapsedLines").textContent)'), foldedCount-3);
		await dragFold(boundary, boundary==='top'?-1000:1000);
		assert.equal(query<number>('parseInt(document.querySelector(".cm-collapsedLines").textContent)'), foldedCount);
		await dragFold(boundary, boundary==='top'?1000:-1000);
		assert.equal(query<number>('parseInt(document.querySelector(".cm-collapsedLines").textContent)'), 1);
		assert.ok(query<number>('document.querySelectorAll(".proposal-change-controls").length')>0);
		await dragFold(boundary, boundary==='top'?-1000:1000);
	}
	assert.equal(query<boolean>('document.body.classList.contains("proposal-fold-dragging")'), false);
	await run('document.querySelector("[data-action=toggleFold]").click();return true;');
	assert.equal(query<number>('document.querySelectorAll(".cm-collapsedLines").length'), 0);
	await run('document.querySelector("[data-action=toggleFold]").click();return true;');
	assert.equal(query<number>('parseInt(document.querySelector(".cm-collapsedLines").textContent)'), foldedCount);

	assert.equal(query<number>('document.querySelectorAll(".proposal-view .proposal-files").length'), 0);
	await until('return document.querySelector(".proposal-file-path")?.textContent==="Smoke/Review.md";');
	assert.equal(query<string>('document.querySelector(".proposal-view h3").textContent'), 'Proposal: Smoke/Review.md');
	assert.equal(query<boolean>('document.querySelector(".proposal-view h3").nextElementSibling.classList.contains("proposal-toolbar")'), true);
	assert.deepEqual(query<string[]>('Array.from(document.querySelectorAll(".proposal-labels span")).map(e=>e.textContent)'), ['Current', 'Proposal']);
	assert.equal(query<boolean>('Array.from(document.querySelectorAll(".proposal-toolbar button")).some(e=>e.textContent==="Add comment")'), false);
	assert.equal(query<string>('document.querySelector(".proposal-file-counts").textContent'), '+1 -1 #0');
	assert.deepEqual(query<string[]>('Array.from(document.querySelectorAll(".proposal-file-action")).map(e=>e.getAttribute("aria-label"))'), ['Apply all', 'Clear all']);
	assert.equal(query<number>('document.querySelectorAll(".proposal-toolbar button").length'), 3);
	assert.equal(query<string>('getComputedStyle(document.querySelector(".proposal-file-view")).padding'), '0px');
	assert.equal(query<boolean>('document.querySelector(".proposal-file-toggle").parentElement.classList.contains("nav-buttons-container")'), true);
	await run('document.querySelector(".proposal-file-toggle").click();return true;');
	await until('return !!document.querySelector(".proposal-folder");');
	await run('document.querySelector(".proposal-file-open").focus();return true;');
	assert.equal(query<string>('getComputedStyle(document.querySelector(".proposal-file-counts")).visibility'), 'hidden');

	await run('v.editor.merge.b.focus();v.editor.merge.b.dispatch({selection:{anchor:10,head:18}});return true;');
	await until('return !!document.querySelector(".proposal-selection-comment");');
	await until('const r=document.querySelector(".proposal-comment-popup").getBoundingClientRect();const pane=document.querySelector(".proposal-editors").getBoundingClientRect();return r.top>=pane.top && r.bottom<=pane.bottom && r.left>=pane.left && r.right<=pane.right;');
	assert.ok(query<number>('document.querySelector(".proposal-selection-comment").getBoundingClientRect().height') <= 28);
	await run('document.querySelector(".proposal-selection-comment").click();return true;');
	await until('return !!document.querySelector(".proposal-comment-input");');
	await run('document.querySelector(".proposal-comment-input").value="Review this text";document.querySelector(".proposal-comment-form").requestSubmit();return true;');
	await until('return v.editor.comments.length===1;');
	assert.equal(query<number>('document.querySelectorAll(".proposal-comments").length'), 0);
	await run('const mark=document.querySelector(".proposal-comment-mark");const r=mark.getBoundingClientRect();mark.dispatchEvent(new MouseEvent("dblclick",{bubbles:true,clientX:r.left+2,clientY:r.top+2}));return true;');
	await until('return document.querySelector(".proposal-comment-input")?.value==="Review this text";');
	await run('document.querySelector(".proposal-comment-input").value="Edited comment";document.querySelector(".proposal-comment-form").requestSubmit();return true;');
	await until('return v.editor.comments[0]?.text==="Edited comment";');
	await run('const mark=document.querySelector(".proposal-comment-mark");const r=mark.getBoundingClientRect();mark.dispatchEvent(new MouseEvent("mousemove",{bubbles:true,clientX:r.left+2,clientY:r.top+2}));return true;');
	await until('return document.querySelector(".proposal-comment-hover")?.textContent.includes("Edited comment");');
	assert.equal(await run(`const original=document.body.className;try {
		for(const theme of ["theme-dark","theme-light"]) {
			document.body.classList.remove("theme-dark","theme-light");document.body.classList.add(theme);
			const sample=document.createElement("div");sample.style.background="var(--background-secondary)";sample.style.color="var(--text-normal)";document.body.append(sample);
			const expected=getComputedStyle(sample);const tip=getComputedStyle(document.querySelector(".proposal-comment-hover").closest(".cm-tooltip"));
			const folded=getComputedStyle(document.querySelector(".cm-collapsedLines"));
			const matches=tip.backgroundColor===expected.backgroundColor && tip.color===expected.color && folded.backgroundColor===expected.backgroundColor && folded.backgroundImage==="none";
			sample.remove();if(!matches)return false;
		}return true;
	}finally{document.body.className=original;}`), true);
	await run('v.editor.merge.b.focus();v.editor.merge.b.dispatch({selection:{anchor:2,head:5}});return true;');
	await until('return !!document.querySelector(".proposal-selection-comment");');
	await run('document.querySelector(".proposal-selection-comment").click();document.querySelector(".proposal-comment-input").value="Remove this comment";document.querySelector(".proposal-comment-form").requestSubmit();return true;');
	await until('return v.editor.comments.length===2;');
	await run('const id=v.editor.comments.find(c=>c.text==="Remove this comment").id;const mark=Array.from(document.querySelectorAll(".proposal-comment-mark")).find(e=>e.dataset.commentId===id);const r=mark.getBoundingClientRect();mark.dispatchEvent(new MouseEvent("dblclick",{bubbles:true,clientX:r.left+2,clientY:r.top+2}));return true;');
	await until('return document.querySelector(".proposal-comment-input")?.value==="Remove this comment";');
	await run('Array.from(document.querySelectorAll(".proposal-comment-form button")).find(e=>e.textContent==="Remove").click();return true;');
	await until('return v.editor.comments.length===1;');
	assert.equal(query<boolean>('document.querySelector(".proposal-editors").textContent.includes("unchanged lines")'), true);
	await run('v.editor.merge.b.dispatch({changes:{from:10,to:18,insert:""}});return true;');
	await until('const record=JSON.parse(await app.vault.adapter.read(".proposal/Smoke/Review.md.json"));return record.comments.length===1 && record.comments[0].from===record.comments[0].to;');
	const beforeApply = await run<string>('return await app.vault.read(app.vault.getAbstractFileByPath("Smoke/Review.md"));');
	assert.equal(beforeApply, original);
	await run('document.querySelector(".cm-merge-revert button").click();return true;');
	await until('return (await app.vault.read(app.vault.getAbstractFileByPath("Smoke/Review.md")))===v.editor.proposal().text;');
	await until('return !document.querySelector(".proposal-editors").textContent.includes("unchanged lines");');
	assert.equal(await run('return (await p.tools.store.active()).length;'), 1);
	assert.equal(await run('return v.editor.comments.length;'), 1);
	assert.equal(await run('return app.workspace.getLeavesOfType("proposal-files").length;'), 1);
	assert.equal(query<number>('document.querySelector(".cm-merge-revert").getBoundingClientRect().width'), 32);
	const beforeCancel = await run<string>('return v.editor.proposal().text;');
	await run('v.editor.merge.b.dispatch({changes:{from:0,to:8,insert:"# Cancel this"}});return true;');
	await until('return !!document.querySelector(".proposal-change-controls button:last-child");');
	await run('document.querySelector(".proposal-change-controls button:last-child").click();return true;');
	await until(`return v.editor.proposal().text===${JSON.stringify(beforeCancel)} && v.editor.merge.chunks.length===0;`);
	assert.equal(await run('await v.flush();return await app.vault.read(app.vault.getAbstractFileByPath("Smoke/Review.md"));'), beforeCancel);
	assert.equal(await run('return v.editor.comments.length;'), 1);
	await run('const e=v.editor.merge.b;e.focus();e.dispatch({selection:{anchor:0,head:e.state.doc.line(30).to},scrollIntoView:true});return true;');
	await until('const tip=document.querySelector(".proposal-comment-popup");if(!tip)return false;const r=tip.getBoundingClientRect();const pane=document.querySelector(".proposal-editors").getBoundingClientRect();return r.top>=pane.top && r.bottom<=pane.bottom && r.left>=pane.left && r.right<=pane.right;');
	await run('v.editor.merge.b.dispatch({selection:{anchor:0},scrollIntoView:true});return true;');
	await run('document.querySelector(".proposal-file-toggle").click();return true;');
	await until('return !document.querySelector(".proposal-file.is-tree");');
	const secondPatch = '*** Begin Patch\n*** Update File: Smoke/Other.md\n@@\n-Other note.\n+Changed note.\n*** End Patch';
	await run(`return await p.proposal_edit({patch:${JSON.stringify(secondPatch)}});`);
	await until('return v.snapshots.length===2;');
	await until('return !!Array.from(document.querySelectorAll(".proposal-file")).find(e=>e.dataset.path==="Smoke/Other.md");');
	assert.equal(query<string>('getComputedStyle(document.querySelector(".proposal-row-actions")).visibility'), 'hidden');
	await run('const row=Array.from(document.querySelectorAll(".proposal-file")).find(e=>e.dataset.path==="Smoke/Other.md");row.querySelector(".proposal-file-open").focus();return true;');
	assert.equal(query<string>('getComputedStyle(Array.from(document.querySelectorAll(".proposal-file")).find(e=>e.dataset.path==="Smoke/Other.md").querySelector(".proposal-row-actions")).visibility'), 'visible');
	assert.equal(query<boolean>('Array.from(document.querySelectorAll(".proposal-file")).every(row=>{const counts=row.querySelector(".proposal-file-counts");const actions=row.querySelector(".proposal-row-actions");return getComputedStyle(counts).visibility==="visible" && actions.getBoundingClientRect().top>=counts.getBoundingClientRect().bottom})'), true);
	await run('Array.from(document.querySelectorAll(".proposal-file")).find(e=>e.dataset.path==="Smoke/Other.md").querySelector("[data-action=clear]").click();return true;');
	await until('return !(await p.tools.store.paths()).includes("Smoke/Other.md");');
	assert.equal(await run('return await app.vault.read(app.vault.getAbstractFileByPath("Smoke/Other.md"));'), 'Other note.\n');
	await run(`return await p.proposal_edit({patch:${JSON.stringify(secondPatch)}});`);
	await until('return !!Array.from(document.querySelectorAll(".proposal-file")).find(e=>e.dataset.path==="Smoke/Other.md");');
	await run('Array.from(document.querySelectorAll(".proposal-file")).find(e=>e.dataset.path==="Smoke/Other.md").querySelector("[data-action=apply]").click();return true;');
	await until('return (await app.vault.read(app.vault.getAbstractFileByPath("Smoke/Other.md")))==="Changed note.\\n";');
	assert.equal(await run('return v.snapshot.path;'), 'Smoke/Review.md');
	await run('await app.vault.modify(app.vault.getAbstractFileByPath("Smoke/Other.md"),"Other note.\\n");return true;');
	await until('return v.snapshots.length===1;');
	await run(`return await p.proposal_edit({patch:${JSON.stringify(secondPatch)}});`);

	await run('document.querySelector(".proposal-file-action[data-action=applyAll]").click();return true;');
	await until('return document.querySelector(".modal-title")?.textContent==="Apply all proposals?";');
	assert.equal(await run('return await app.vault.read(app.vault.getAbstractFileByPath("Smoke/Other.md"));'), 'Other note.\n');
	await run('Array.from(document.querySelectorAll(".modal button")).find(b=>b.textContent==="Confirm").click();return true;');
	await until('return (await app.vault.read(app.vault.getAbstractFileByPath("Smoke/Other.md")))==="Changed note.\\n";');
	await until('return !v.editor && (await p.tools.store.paths()).length===0;');
	await run('await p.openReview("Smoke/Review.md");return true;');
	await run('v.editor.merge.b.dispatch({changes:{from:0,insert:"Apply through toolbar\\n"}});document.querySelector(".proposal-toolbar [data-action=applyCurrent]").click();return true;');
	await until('return (await app.vault.read(app.vault.getAbstractFileByPath("Smoke/Review.md"))).startsWith("Apply through toolbar");');
	await run('await p.openReview("Smoke/Other.md");v.editor.merge.b.dispatch({changes:{from:0,insert:"Clear through toolbar\\n"}});document.querySelector(".proposal-toolbar [data-action=clearCurrent]").click();return true;');
	await until('return !v.editor && !v.snapshot;');
	assert.equal(await run('return await app.vault.read(app.vault.getAbstractFileByPath("Smoke/Other.md"));'), 'Changed note.\n');
	await run('await p.openReview("Smoke/Review.md");return true;');
	await run('const displayed=await p.tools.store.read("Smoke/Review.md");await app.vault.modify(app.vault.getAbstractFileByPath(displayed.path),displayed.current+"Outside edit\\n");try{await p.tools.store.apply(displayed);throw new Error("Stale apply succeeded")}catch(e){if(!e.message.includes("Text changed"))throw e}return true;');
	await run('await p.openReview("Smoke/Review.md");v.editor.merge.b.dispatch({changes:{from:0,insert:"Saved before reload\\n"}});return true;');
	cli('plugin:reload', 'id=proposal');
	await until('return !!p && p.tools.flushers.size===1;');
	assert.equal(query<number>('document.querySelectorAll(".proposal-status").length'), 1);
	assert.equal(await run('return JSON.parse(await app.vault.adapter.read(".proposal/Smoke/Review.md.json")).text.startsWith("Saved before reload");'), true);
	await run('await p.openReview("Smoke/Review.md");return true;');
	await until('return !!document.querySelector(".proposal-file-action[data-action=clearAll]");');
	await run('document.querySelector(".proposal-file-action[data-action=clearAll]").click();return true;');
	await until('return document.querySelector(".modal-title")?.textContent==="Clear all proposals?";');
	await run('Array.from(document.querySelectorAll(".modal button")).find(b=>b.textContent==="Confirm").click();return true;');
	await until('return (await p.tools.store.paths()).length===0;');
	await until('return app.workspace.getLeavesOfType("proposal-files").length===1;');
	assert.equal(await run('return app.workspace.getMostRecentLeaf(app.workspace.leftSplit)?.view.getViewType();'), 'proposal-files');
	assert.equal(await run('return await app.vault.read(app.vault.getAbstractFileByPath("Smoke/Other.md"));'), 'Changed note.\n');
	execFileSync('open', [`obsidian://proposal?vault=${encodeURIComponent(vault)}&file=Smoke%2FOther.md`]);
	await until('return v.snapshot?.path==="Smoke/Other.md";');
	assert.equal(await run('return (await p.tools.store.paths()).length;'), 0);
	cli('plugin:disable', 'id=proposal');
	await until('return !p;');
	assert.equal(query<number>('document.querySelectorAll(".proposal-status").length'), 0);
	cli('plugin:enable', 'id=proposal');
	await until('return !!p;');
	assert.equal(query<number>('document.querySelectorAll(".proposal-status").length'), 1);
});

void test('proposal lifecycle follows open editors and cleans missing notes after reload', { timeout: 120000 }, async () => {
	await run(`await p.tools.flush();
		const old=app.vault.getAbstractFileByPath("Lifecycle");if(old)await app.vault.delete(old,true);
		const moved=app.vault.getAbstractFileByPath("LifecycleMoved");if(moved)await app.vault.delete(moved,true);
		await app.vault.createFolder("Lifecycle/Nested");
		await app.vault.create("Lifecycle/Nested/Note.md","Original.\\n");
		await p.openReview("Lifecycle/Nested/Note.md");return true;`);
	await run(`v.editor.merge.b.dispatch({changes:{from:0,insert:"Unsaved "}});window.clearTimeout(v.timer);
		await app.vault.rename(app.vault.getAbstractFileByPath("Lifecycle/Nested/Note.md"),"Lifecycle/Nested/Renamed.md");
		return true;`);
	assert.equal(await run('return v.snapshot?.path;'), 'Lifecycle/Nested/Renamed.md');
	await run('await p.tools.flush();return true;');
	assert.equal(await run('return (await p.tools.store.read("Lifecycle/Nested/Renamed.md")).proposal.text;'), 'Unsaved Original.\n');
	assert.equal(await run('return await app.vault.adapter.exists(".proposal/Lifecycle/Nested/Note.md.json");'), false);

	await run(`const snapshot=await p.tools.store.read("Lifecycle/Nested/Renamed.md");
		await p.tools.store.manual(snapshot.path,snapshot.proposal,snapshot.proposal.text,[{id:"keep",from:0,to:1,text:"Keep comment"}]);
		await v.refresh();
		v.editor.merge.b.dispatch({changes:{from:0,insert:"Folder "}});window.clearTimeout(v.timer);
		await app.vault.rename(app.vault.getAbstractFileByPath("Lifecycle"),"LifecycleMoved");return true;`);
	await run('await p.tools.flush();return true;');
	assert.equal(await run('return v.snapshot?.path;'), 'LifecycleMoved/Nested/Renamed.md');
	const moved = await run<{ text: string; comments: { text: string }[] }>('return (await p.tools.store.read(v.snapshot.path)).proposal;');
	assert.equal(moved.text, 'Folder Unsaved Original.\n');
	assert.equal(moved.comments[0]?.text, 'Keep comment');
	assert.equal(await run('return await app.vault.adapter.exists(".proposal/Lifecycle/Nested/Renamed.md.json");'), false);

	await run(`v.editor.merge.b.dispatch({changes:{from:0,insert:"Discard on deletion "}});window.clearTimeout(v.timer);
		await app.vault.delete(app.vault.getAbstractFileByPath(v.snapshot.path));
		await p.tools.flush();await p.tools.store.active();return true;`);
	assert.equal(await run('return v.snapshot?.path ?? null;'), null);
	assert.equal(await run('return await app.vault.adapter.exists(".proposal/LifecycleMoved/Nested/Renamed.md.json");'), false);
	assert.equal(await run('return !!v.editor;'), false);
	await run(`const old=app.vault.getAbstractFileByPath("CaseFolder") ?? app.vault.getAbstractFileByPath("casefolder");
		if(old)await app.vault.delete(old,true);
		await app.vault.createFolder("CaseFolder");await app.vault.create("CaseFolder/Case.md","Original case.\\n");
		const snapshot=await p.tools.store.read("CaseFolder/Case.md");
		await p.tools.store.manual(snapshot.path,snapshot.proposal,"Case proposal.\\n",[]);
		await app.vault.rename(app.vault.getAbstractFileByPath("CaseFolder/Case.md"),"CaseFolder/case.md");
		await p.tools.store.active();return true;`);
	assert.equal(await run('return (await p.tools.store.read("CaseFolder/case.md")).proposal.text;'), 'Case proposal.\n');
	await run('await app.vault.rename(app.vault.getAbstractFileByPath("CaseFolder"),"casefolder");await p.tools.store.active();return true;');
	assert.equal(await run('return (await p.tools.store.read("casefolder/case.md")).proposal.text;'), 'Case proposal.\n');
	assert.equal(await run('return (await p.tools.store.paths()).includes("casefolder/case.md");'), true);
	cli('plugin:disable', 'id=proposal');
	await until('return !p;');
	await run('await app.vault.rename(app.vault.getAbstractFileByPath("casefolder/case.md"),"casefolder/CASE.md");return true;');
	cli('plugin:enable', 'id=proposal');
	await until('return !!p && !await app.vault.adapter.exists(".proposal/casefolder/case.md.json");');
	assert.equal(await run('return !!app.vault.getAbstractFileByPath("casefolder/CASE.md");'), true);

	await run(`await app.vault.create("LifecycleMoved/Keep.md","Keep original.\\n");
		const snapshot=await p.tools.store.read("LifecycleMoved/Keep.md");
		await p.tools.store.manual(snapshot.path,snapshot.proposal,"Keep proposal.\\n",[]);
		await app.vault.adapter.write(".proposal/LifecycleMoved/Missing.md.json",JSON.stringify({version:1,text:"Missing",comments:[]}));
		return true;`);
	cli('plugin:reload', 'id=proposal');
	await until('return !!p && !await app.vault.adapter.exists(".proposal/LifecycleMoved/Missing.md.json");');
	assert.equal(await run('return (await p.tools.store.read("LifecycleMoved/Keep.md")).proposal.text;'), 'Keep proposal.\n');
	await run('await p.openReview("LifecycleMoved/Keep.md");return true;');
	await run(`v.editor.merge.b.dispatch({changes:{from:0,insert:"After reload "}});window.clearTimeout(v.timer);
		await app.vault.rename(app.vault.getAbstractFileByPath("LifecycleMoved/Keep.md"),"LifecycleMoved/Reloaded.md");
		await p.tools.flush();return true;`);
	assert.equal(await run('return (await p.tools.store.read("LifecycleMoved/Reloaded.md")).proposal.text;'), 'After reload Keep proposal.\n');
	assert.equal(await run('return (await p.tools.store.active()).some(s=>s.path==="LifecycleMoved/Reloaded.md");'), true);
	await run(`await p.openReview("LifecycleMoved/Reloaded.md");await p.tools.store.active();
		window.clearTimeout(v.refreshTimer);
		const io=p.tools.store.io;
		const exists=io.originalExists.bind(io);
		let enter,release;
		const started=new Promise(resolve=>{enter=resolve;});
		const blocked=new Promise(resolve=>{release=resolve;});
		io.originalExists=async path=>{enter();await blocked;return exists(path);};
		const refreshing=v.refresh();
		try {
			await started;
			await app.vault.delete(app.vault.getAbstractFileByPath("LifecycleMoved/Reloaded.md"));
		} finally {io.originalExists=exists;release();}
		await refreshing;await p.tools.store.active();return true;`);
	assert.equal(await run('return v.snapshot?.path ?? null;'), null);
	assert.equal(await run('return await app.vault.adapter.exists(".proposal/LifecycleMoved/Reloaded.md.json");'), false);
	assert.equal(query<boolean>('Array.from(document.querySelectorAll(".notice")).some(n=>n.textContent.includes("Markdown note not found"))'), false);
});
