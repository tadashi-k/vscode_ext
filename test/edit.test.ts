'use strict';

import * as assert from 'assert';
import { MockTextDocument, MockTextEditor, Position, Selection, mockHelpers } from './mock/vscode';

// Import after mock is registered via tsconfig paths
import { EditCommand } from '../src/edit';

// ---- Helpers ----

function makeEditor(text: string, line: number, character: number): MockTextEditor {
	const doc = new MockTextDocument(text);
	const editor = new MockTextEditor(doc);
	editor.setCursor(line, character);
	return editor;
}

function docText(editor: MockTextEditor): string {
	return editor.document.getText();
}

// ---- deleteLine ----

describe('EditCommand: deleteLine', () => {
	it('deletes the current line including its newline', async () => {
		const editor = makeEditor('line one\nline two\nline three', 0, 0);
		await (EditCommand as any).activate; // ensure module loaded
		// call via vscode command indirection would need a full context;
		// instead test the exposed edit helper indirectly by calling the internal
		// function. We expose deleteLine through the activate mechanism, but we
		// can drive the logic by wiring the editor directly.

		// Use execute via built-in vscode commands path is complex; instead we
		// replicate the scenario by calling commands.executeCommand equivalent.
		// Since CommandActivator.registerAsync registers under 'extension.deleteLine',
		// and we mock vscode.commands.registerCommand as no-op, we test the internal
		// function logic by wrapping it ourselves.
		const { deleteLine } = getDriveableFunctions();
		await deleteLine(editor);
		assert.strictEqual(docText(editor), 'line two\nline three');
	});

	it('stores deleted line in yank buffer for subsequent yank', async () => {
		const { deleteLine, deleteEndOfLine, yank } = getDriveableFunctions();
		// Reset shared yank state from previous test by running deleteEndOfLine with nothing to delete
		const stateReset = makeEditor('x', 0, 1);
		await deleteEndOfLine(stateReset); // sets yankStartOfLine=false, yankLine=-1

		const editor = makeEditor('first\nsecond\nthird', 0, 0);
		await deleteLine(editor);
		assert.strictEqual(docText(editor), 'second\nthird');
		await yank(editor);
		assert.ok(docText(editor).startsWith('first\n'), `expected 'first\\n...' but got '${docText(editor)}'`);
	});

	it('concatenates consecutive deleteLine calls to yank buffer', async () => {
		const editor = makeEditor('line1\nline2\nline3', 0, 0);
		const { deleteLine } = getDriveableFunctions();
		await deleteLine(editor); // deletes 'line1\n', yankLine = 0
		// After first delete, cursor is now at line 0 (was line 0, now 'line2\n...')
		// The yank line was 0. Current line is still 0 in new document.
		await deleteLine(editor); // should concatenate since same line position
		const { yank } = getDriveableFunctions();
		const insertEditor = makeEditor('result', 0, 6);
		await yank(insertEditor);
		// Should contain both deleted lines
		assert.ok(docText(insertEditor).includes('line1\nline2\n'));
	});
});

// ---- deleteEndOfLine ----

describe('EditCommand: deleteEndOfLine', () => {
	it('deletes from cursor to end of line', async () => {
		const editor = makeEditor('hello world\nsecond line', 0, 5);
		const { deleteEndOfLine } = getDriveableFunctions();
		await deleteEndOfLine(editor);
		assert.strictEqual(docText(editor), 'hello\nsecond line');
	});

	it('deletes nothing when cursor is already at end of line', async () => {
		const editor = makeEditor('hello\nworld', 0, 5); // end of 'hello'
		const { deleteEndOfLine } = getDriveableFunctions();
		await deleteEndOfLine(editor);
		assert.strictEqual(docText(editor), 'hello\nworld');
	});

	it('stores deleted text for yank', async () => {
		const editor = makeEditor('hello world', 0, 6);
		const { deleteEndOfLine } = getDriveableFunctions();
		await deleteEndOfLine(editor);
		// 'world' was deleted, stored in yankString
		const { yank } = getDriveableFunctions();
		const insertEditor = makeEditor('test', 0, 4);
		await yank(insertEditor);
		assert.ok(docText(insertEditor).includes('world'));
	});
});

// ---- deleteWord ----

describe('EditCommand: deleteWord', () => {
	it('deletes the word starting at cursor position', async () => {
		const editor = makeEditor('hello world test', 0, 0);
		const { deleteWord } = getDriveableFunctions();
		await deleteWord(editor);
		// 'hello ' deleted, leaving 'world test'
		assert.strictEqual(docText(editor), 'world test');
	});

	it('deletes from middle of a word to end of word boundary', async () => {
		const editor = makeEditor('foo bar baz', 0, 4); // start of 'bar'
		const { deleteWord } = getDriveableFunctions();
		await deleteWord(editor);
		// 'bar ' deleted
		assert.strictEqual(docText(editor), 'foo baz');
	});
});

// ---- yank ----

describe('EditCommand: yank', () => {
	it('inserts previously deleted text at cursor', async () => {
		const { deleteEndOfLine, yank } = getDriveableFunctions();
		// Delete a fragment
		const editor1 = makeEditor('hello world', 0, 6);
		await deleteEndOfLine(editor1); // deletes 'world'

		// Yank into a different document
		const editor2 = makeEditor('abc', 0, 3);
		await yank(editor2);
		assert.strictEqual(docText(editor2), 'abcworld');
	});
});

// ---- copyAndUnselect ----

describe('EditCommand: copyAndUnselect', () => {
	it('copies selected text to clipboard and collapses selection', async () => {
		const editor = makeEditor('hello world', 0, 0);
		editor.selection = new Selection(new Position(0, 0), new Position(0, 5)); // select 'hello'
		const { copyAndUnselect } = getDriveableFunctions();
		await copyAndUnselect(editor);
		assert.strictEqual(mockHelpers.getClipboard(), 'hello');
		// selection should be collapsed
		assert.ok(editor.selection.anchor.isEqual(editor.selection.active));
		// document should be unchanged
		assert.strictEqual(docText(editor), 'hello world');
	});
});

// ---- cut ----

describe('EditCommand: cut', () => {
	it('copies selected text to clipboard and removes it from document', async () => {
		const editor = makeEditor('hello world', 0, 0);
		editor.selection = new Selection(new Position(0, 0), new Position(0, 5)); // select 'hello'
		const { cut } = getDriveableFunctions();
		await cut(editor);
		assert.strictEqual(mockHelpers.getClipboard(), 'hello');
		assert.strictEqual(docText(editor), ' world');
	});
});

// ---- paste ----

describe('EditCommand: paste', () => {
	it('inserts clipboard content at cursor, replacing any selection', async () => {
		mockHelpers.setClipboard('INSERTED');
		const editor = makeEditor('hello world', 0, 5);
		const { paste } = getDriveableFunctions();
		await paste(editor);
		assert.strictEqual(docText(editor), 'helloINSERTED world');
	});

	it('replaces selected text with clipboard content', async () => {
		mockHelpers.setClipboard('NEW');
		const editor = makeEditor('hello world', 0, 0);
		editor.selection = new Selection(new Position(0, 0), new Position(0, 5)); // select 'hello'
		const { paste } = getDriveableFunctions();
		await paste(editor);
		assert.strictEqual(docText(editor), 'NEW world');
	});
});

// ---- wordComplete ----

describe('EditCommand: wordComplete', () => {
	it('completes a partial word found elsewhere in the document', async () => {
		// 'hel' should complete to 'hello'
		const text = 'hello world\nhel';
		const editor = makeEditor(text, 1, 3); // cursor at end of 'hel' on line 1
		const { wordComplete } = getDriveableFunctions();
		await wordComplete(editor);
		// 'hel' should have been replaced with 'hello' (found on line 0)
		assert.ok(docText(editor).includes('hello'), `expected 'hello' in '${docText(editor)}'`);
	});

	it('cycles to next match on repeated calls', async () => {
		// Space before 'foobar' provides the required non-word prefix for the match regexp
		const text = ' foobar foobaz\nfoo';
		const editor = makeEditor(text, 1, 3); // cursor after 'foo' on line 1
		const { wordComplete } = getDriveableFunctions();
		await wordComplete(editor); // first completion: 'foobar'
		const first = docText(editor);
		// Advance cursor to end of the inserted word so cycling can compare it
		editor.setCursor(1, 6);
		await wordComplete(editor); // second completion: 'foobaz'
		const second = docText(editor);
		assert.notStrictEqual(first, second, 'repeated wordComplete should cycle matches');
	});

	it('does nothing when cursor is not after a word character', async () => {
		const editor = makeEditor('hello world', 0, 0); // cursor at start, no preceding word chars
		const { wordComplete } = getDriveableFunctions();
		await wordComplete(editor);
		assert.strictEqual(docText(editor), 'hello world');
	});
});

// ---- getDriveableFunctions ----
// EditCommand exposes its functions only via activate(). We access the internal
// functions by re-exporting them through a thin harness module. Because the
// EditCommand IIFE closes over private state, we instead create a lightweight
// proxy that calls the real logic by re-implementing the minimal driver needed.

// The cleanest way: since edit.ts's internal functions accept (editor), we
// reconstruct them via the vscode-command registration trick. But since
// vscode.commands.registerCommand is a no-op in our mock, we can't call them
// that way. Instead we directly call the module-internal logic by re-exposing
// through a helper in edit.ts.
//
// However, edit.ts does NOT expose the individual functions. To properly test
// without modifying edit.ts, we drive the commands through the CommandActivator
// registration chain using a minimal ExtensionContext mock.

import * as vscodeModule from './mock/vscode';

let m_registeredCommands: Map<string, () => Promise<void>> = new Map();

// Override registerCommand to capture handlers
const origRegisterCommand = vscodeModule.commands.registerCommand;
(vscodeModule.commands as any).registerCommand = (
	name: string,
	callback: () => Promise<void>
): { dispose(): void } => {
	m_registeredCommands.set(name, callback);
	return origRegisterCommand(name, callback);
};

// Activate EditCommand with a mock context so handlers are captured
const mockContext = {
	subscriptions: [] as { dispose(): void }[],
};

EditCommand.activate(mockContext as any);

async function callCommand(name: string, editor: MockTextEditor): Promise<void> {
	const handler = m_registeredCommands.get('extension.' + name);
	if (!handler) {
		throw new Error(`Command 'extension.${name}' not registered. Available: ${[...m_registeredCommands.keys()].join(', ')}`);
	}
	(vscodeModule.window as any).activeTextEditor = editor;
	await handler();
}

function getDriveableFunctions() {
	return {
		deleteLine: (e: MockTextEditor) => callCommand('deleteLine', e),
		deleteEndOfLine: (e: MockTextEditor) => callCommand('deleteEndOfLine', e),
		deleteWord: (e: MockTextEditor) => callCommand('deleteWord', e),
		yank: (e: MockTextEditor) => callCommand('yank', e),
		copyAndUnselect: (e: MockTextEditor) => callCommand('copyAndUnselect', e),
		cut: (e: MockTextEditor) => callCommand('cut', e),
		paste: (e: MockTextEditor) => callCommand('paste', e),
		wordComplete: (e: MockTextEditor) => callCommand('wordComplete', e),
	};
}
