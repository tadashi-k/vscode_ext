'use strict';

import * as assert from 'assert';
import { MockTextDocument, MockTextEditor, Position, Selection, mockHelpers } from './mock/vscode';
import { MacroCommand } from '../src/macro';
import { EditCommand } from '../src/edit';
import * as vscodeModule from './mock/vscode';

// ---- Command registration capture ----

const m_registeredCommands: Map<string, () => Promise<void>> = new Map();

const m_origRegisterCommand = vscodeModule.commands.registerCommand;
(vscodeModule.commands as any).registerCommand = (
	name: string,
	callback: () => Promise<void>
): { dispose(): void } => {
	m_registeredCommands.set(name, callback);
	return m_origRegisterCommand(name, callback);
};

const m_mockContext = {
	subscriptions: [] as { dispose(): void }[],
};

MacroCommand.activate(m_mockContext as any);
EditCommand.activate(m_mockContext as any);

// ---- Test state ----

let m_isRecording = false;

const m_eventHandlers = mockHelpers.getEventHandlers();

// ---- Helpers ----

function makeEditor(text: string, line: number = 0, character: number = 0): MockTextEditor {
	const doc = new MockTextDocument(text);
	const editor = new MockTextEditor(doc);
	editor.setCursor(line, character);
	return editor;
}

async function callCommand(name: string, editor: MockTextEditor): Promise<void> {
	const handler = m_registeredCommands.get('extension.' + name);
	if (!handler) {
		throw new Error(`Command 'extension.${name}' not registered. Available: ${[...m_registeredCommands.keys()].join(', ')}`);
	}
	(vscodeModule.window as any).activeTextEditor = editor;
	await handler();
}

async function startRecording(editor: MockTextEditor): Promise<void> {
	if (m_isRecording) { return; }
	await callCommand('macroRecord', editor);
	m_isRecording = true;
}

async function stopRecording(editor: MockTextEditor): Promise<void> {
	if (!m_isRecording) { return; }
	await callCommand('macroRecord', editor);
	m_isRecording = false;
}

async function replay(editor: MockTextEditor): Promise<void> {
	await callCommand('macroReplay', editor);
}

/** Fire a collapsed selection-change event at a given position. */
function fireSelectionEvent(editor: MockTextEditor, active: Position): void {
	const sel = new Selection(active, active);
	const event = { selections: [sel], textEditor: editor };
	m_eventHandlers.onDidChangeTextEditorSelection.forEach(h => h(event));
}

/** Fire a selection-change event with anchor != active (range selection). */
function fireRangeSelectionEvent(editor: MockTextEditor, anchor: Position, active: Position): void {
	const sel = new Selection(anchor, active);
	const event = { selections: [sel], textEditor: editor };
	m_eventHandlers.onDidChangeTextEditorSelection.forEach(h => h(event));
}

/** Fire a text-document-change event simulating an insert or delete. */
function fireDocChangeEvent(text: string, rangeOffset: number, rangeLength: number): void {
	const event = { contentChanges: [{ text, rangeOffset, rangeLength }] };
	m_eventHandlers.onDidChangeTextDocument.forEach(h => h(event));
}

/** Fire the active-editor-change event (simulates switching to a different editor). */
function fireActiveEditorChange(): void {
	m_eventHandlers.onDidChangeActiveTextEditor.forEach(h => h(undefined));
}

// ---- Cleanup ----

afterEach(async () => {
	if (m_isRecording) {
		await stopRecording(makeEditor(''));
	}
});

// ============================================================
// Document-edit recording (event-based, no push calls — keeps
// cmdTime at 0 so the > 100ms timing guard is always satisfied)
// ============================================================

describe('MacroCommand: recording document edits', () => {
	it('captures text insertion and replays insert at cursor', async () => {
		const editor = makeEditor('hello', 0, 5);
		await startRecording(editor);

		// Setup: establish lastSelection so the post-insert event can clear doEdit
		fireSelectionEvent(editor, new Position(0, 5));
		// Insert 'X' at offset 5; doEdit flag becomes true
		fireDocChangeEvent('X', 5, 0);
		// Cursor advances by 1 after the insert (offset 6)
		fireSelectionEvent(editor, new Position(0, 6));

		await stopRecording(editor);

		const replayEditor = makeEditor('abc', 0, 3);
		await replay(replayEditor);
		assert.ok(
			replayEditor.document.getText().includes('X'),
			`Expected 'X' in '${replayEditor.document.getText()}'`
		);
	});

	it('captures character deletion and replays delete at cursor', async () => {
		const editor = makeEditor('hello', 0, 0);
		await startRecording(editor);

		// Setup: establish lastOffset = 0
		fireSelectionEvent(editor, new Position(0, 0));
		// Delete 1 char at offset 0; doEdit flag becomes true
		fireDocChangeEvent('', 0, 1);
		// Cursor stays at offset 0 (no movement, delta = 0)
		fireSelectionEvent(editor, new Position(0, 0));

		await stopRecording(editor);

		// Replay: 'w' at position 0 should be deleted
		const replayEditor = makeEditor('world', 0, 0);
		await replay(replayEditor);
		assert.strictEqual(replayEditor.document.getText(), 'orld');
	});

	it('does not capture edits fired before recording starts', async () => {
		const editor = makeEditor('test', 0, 0);

		// Events fired before recording must be ignored
		fireDocChangeEvent('X', 0, 0);
		fireDocChangeEvent('Y', 1, 0);

		await startRecording(editor);
		await stopRecording(editor);

		const replayEditor = makeEditor('clean', 0, 0);
		await replay(replayEditor);
		assert.strictEqual(replayEditor.document.getText(), 'clean');
	});

	it('records forward-delete then cursor-down when no selection event fires after delete', async () => {
		// Reproduces bug: forward Delete leaves doEdit=true because VS Code does not fire
		// onDidChangeTextEditorSelection when the cursor position doesn't change.
		// The subsequent CursorDown event was swallowed by the doEdit branch instead of
		// being recorded as a cursor movement.
		const editor = makeEditor('hello\nworld', 0, 0);

		// Initialize lastSelection/lastOffset BEFORE recording so this event is not recorded
		// as a spurious cursor movement (the handler updates state outside the recording guard).
		fireSelectionEvent(editor, new Position(0, 0));

		await startRecording(editor);

		// Forward delete at offset 0 (Delete key): cursor does NOT move (no selection event follows)
		fireDocChangeEvent('', 0, 1);
		// User presses CursorDown — selection event fires without a preceding post-delete event
		fireSelectionEvent(editor, new Position(1, 0));

		await stopRecording(editor);

		const m_executedCmds: string[] = [];
		const m_origExec = vscodeModule.commands.executeCommand;
		(vscodeModule.commands as any).executeCommand = (cmd: string) => {
			m_executedCmds.push(cmd);
			return Promise.resolve();
		};

		const replayEditor = makeEditor('hello\nworld', 0, 0);
		await replay(replayEditor);
		// Drain microtasks so async replay steps (Delete then CursorDown) all complete
		await new Promise<void>(r => setImmediate(r));

		(vscodeModule.commands as any).executeCommand = m_origExec;

		assert.strictEqual(replayEditor.document.getText(), 'ello\nworld', 'forward-delete should be replayed');
		assert.ok(m_executedCmds.includes('cursorDown'), `Expected cursorDown in [${m_executedCmds.join(', ')}]`);
	});
});

// ============================================================
// Cursor-movement recording (event-based, no push calls)
// ============================================================

describe('MacroCommand: recording cursor movements', () => {
	it('captures cursor-right move and replays cursorRight', async () => {
		const editor = makeEditor('hello', 0, 0);
		await startRecording(editor);

		// First event: set lastOffset = 0
		fireSelectionEvent(editor, new Position(0, 0));
		// Second event: move right to offset 1
		fireSelectionEvent(editor, new Position(0, 1));

		await stopRecording(editor);

		let m_executedCmd = '';
		const m_origExec = vscodeModule.commands.executeCommand;
		(vscodeModule.commands as any).executeCommand = (cmd: string) => {
			m_executedCmd = cmd;
			return Promise.resolve();
		};
		await replay(makeEditor('hello', 0, 0));
		(vscodeModule.commands as any).executeCommand = m_origExec;

		assert.strictEqual(m_executedCmd, 'cursorRight');
	});

	it('captures cursor-left move and replays cursorLeft', async () => {
		const editor = makeEditor('hello', 0, 3);
		await startRecording(editor);

		fireSelectionEvent(editor, new Position(0, 3));
		fireSelectionEvent(editor, new Position(0, 2));

		await stopRecording(editor);

		let m_executedCmd = '';
		const m_origExec = vscodeModule.commands.executeCommand;
		(vscodeModule.commands as any).executeCommand = (cmd: string) => {
			m_executedCmd = cmd;
			return Promise.resolve();
		};
		await replay(makeEditor('hello', 0, 3));
		(vscodeModule.commands as any).executeCommand = m_origExec;

		assert.strictEqual(m_executedCmd, 'cursorLeft');
	});

	it('captures cursor-down move and replays cursorDown', async () => {
		const editor = makeEditor('hello\nworld', 0, 0);
		await startRecording(editor);

		// line 0 offset 0 → line 1 offset 6 (= "hello\n".length)
		fireSelectionEvent(editor, new Position(0, 0));
		fireSelectionEvent(editor, new Position(1, 0));

		await stopRecording(editor);

		let m_executedCmd = '';
		const m_origExec = vscodeModule.commands.executeCommand;
		(vscodeModule.commands as any).executeCommand = (cmd: string) => {
			m_executedCmd = cmd;
			return Promise.resolve();
		};
		await replay(makeEditor('hello\nworld', 0, 0));
		(vscodeModule.commands as any).executeCommand = m_origExec;

		assert.strictEqual(m_executedCmd, 'cursorDown');
	});

	it('captures cursor-up move and replays cursorUp', async () => {
		const editor = makeEditor('hello\nworld', 1, 0);
		await startRecording(editor);

		fireSelectionEvent(editor, new Position(1, 0));
		fireSelectionEvent(editor, new Position(0, 0));

		await stopRecording(editor);

		let m_executedCmd = '';
		const m_origExec = vscodeModule.commands.executeCommand;
		(vscodeModule.commands as any).executeCommand = (cmd: string) => {
			m_executedCmd = cmd;
			return Promise.resolve();
		};
		await replay(makeEditor('hello\nworld', 1, 0));
		(vscodeModule.commands as any).executeCommand = m_origExec;

		assert.strictEqual(m_executedCmd, 'cursorUp');
	});

	it('captures word-right move and replays cursorWordEndRight', async () => {
		// lastSelection at (0,0) inside 'hello'; new active at end-of-word (0,5)
		const editor = makeEditor('hello world', 0, 0);
		await startRecording(editor);

		fireSelectionEvent(editor, new Position(0, 0));       // lastOffset=0, wordRange=(0,0)-(0,5)
		fireSelectionEvent(editor, new Position(0, 5));       // offset=5>0, wordRange.end=(0,5) == active ✓

		await stopRecording(editor);

		let m_executedCmd = '';
		const m_origExec = vscodeModule.commands.executeCommand;
		(vscodeModule.commands as any).executeCommand = (cmd: string) => {
			m_executedCmd = cmd;
			return Promise.resolve();
		};
		await replay(makeEditor('hello world', 0, 0));
		(vscodeModule.commands as any).executeCommand = m_origExec;

		assert.strictEqual(m_executedCmd, 'cursorWordEndRight');
	});

	it('captures word-left move and replays cursorWordLeft', async () => {
		// lastSelection at (0,4) inside 'hello'; new active at start-of-word (0,0)
		const editor = makeEditor('hello world', 0, 4);
		await startRecording(editor);

		fireSelectionEvent(editor, new Position(0, 4));       // lastOffset=4, wordRange=(0,0)-(0,5)
		fireSelectionEvent(editor, new Position(0, 0));       // offset=0<4, wordRange.start=(0,0) == active ✓

		await stopRecording(editor);

		let m_executedCmd = '';
		const m_origExec = vscodeModule.commands.executeCommand;
		(vscodeModule.commands as any).executeCommand = (cmd: string) => {
			m_executedCmd = cmd;
			return Promise.resolve();
		};
		await replay(makeEditor('hello world', 0, 4));
		(vscodeModule.commands as any).executeCommand = m_origExec;

		assert.strictEqual(m_executedCmd, 'cursorWordLeft');
	});

	it('captures line-end move and replays cursorEnd', async () => {
		// 'x hello' (7 chars): line end is at (0,7); 'x' word ends at (0,1).
		// Moving from inside 'x' (wordRange.end=(0,1)) to (0,7) doesn't trigger
		// WordRight (wordRange.end != active), so LineEnd fires instead.
		const editor = makeEditor('x hello', 0, 0);
		await startRecording(editor);

		fireSelectionEvent(editor, new Position(0, 1));      // lastOffset=1, inside word 'x'
		fireSelectionEvent(editor, new Position(0, 7));      // line end, NOT word end of 'x'

		await stopRecording(editor);

		let m_executedCmd = '';
		const m_origExec = vscodeModule.commands.executeCommand;
		(vscodeModule.commands as any).executeCommand = (cmd: string) => {
			m_executedCmd = cmd;
			return Promise.resolve();
		};
		await replay(makeEditor('hello', 0, 2));
		(vscodeModule.commands as any).executeCommand = m_origExec;

		assert.strictEqual(m_executedCmd, 'cursorEnd');
	});

	it('captures line-top move and replays cursorHome', async () => {
		// '  hello' (2 spaces + hello): firstNonWS=2.
		// Moving from (0,0) (a space, wordRange=undefined) to (0,2) doesn't trigger
		// WordLeft (no wordRange at (0,0)), so LineTop fires instead.
		const editor = makeEditor('  hello', 0, 0);
		await startRecording(editor);

		fireSelectionEvent(editor, new Position(0, 0));      // lastOffset=0, at a space (no word)
		fireSelectionEvent(editor, new Position(0, 2));      // firstNonWS, NOT a word start from (0,0)

		await stopRecording(editor);

		let m_executedCmd = '';
		const m_origExec = vscodeModule.commands.executeCommand;
		(vscodeModule.commands as any).executeCommand = (cmd: string) => {
			m_executedCmd = cmd;
			return Promise.resolve();
		};
		await replay(makeEditor('hello', 0, 3));
		(vscodeModule.commands as any).executeCommand = m_origExec;

		assert.strictEqual(m_executedCmd, 'cursorHome');
	});

	it('records move with selection (anchor != active) with Select suffix', async () => {
		const editor = makeEditor('hello', 0, 0);
		await startRecording(editor);

		// Setup: collapsed at position 0
		fireSelectionEvent(editor, new Position(0, 0));
		// Move right with selection: anchor stays at 0, active moves to 1
		fireRangeSelectionEvent(editor, new Position(0, 0), new Position(0, 1));

		await stopRecording(editor);

		let m_executedCmd = '';
		const m_origExec = vscodeModule.commands.executeCommand;
		(vscodeModule.commands as any).executeCommand = (cmd: string) => {
			m_executedCmd = cmd;
			return Promise.resolve();
		};
		await replay(makeEditor('hello', 0, 0));
		(vscodeModule.commands as any).executeCommand = m_origExec;

		// replayMove appends 'Select;' when withSelect() was called
		assert.ok(m_executedCmd.includes('Select'), `Expected 'Select' in '${m_executedCmd}'`);
	});
});

// ============================================================
// Internal edit command recording (push()-based)
// These tests must run AFTER event-only tests because MacroCommand.push()
// sets cmdTime = Date.now(), which can suppress events in tests that follow
// within 100 ms.  Placing them here keeps the event-only sections above
// unaffected while still validating push()-based recording.
// ============================================================

describe('MacroCommand: recording internal edit commands', () => {
	it('replays deleteWord by re-executing the internal function', async () => {
		const editor = makeEditor('hello world', 0, 0);

		await startRecording(editor);
		await callCommand('deleteWord', editor);
		await stopRecording(editor);

		const replayEditor = makeEditor('hello world', 0, 0);
		await replay(replayEditor);
		assert.strictEqual(replayEditor.document.getText(), 'world');
	});

	it('does not record spurious Delete when VS Code fires events during editor.edit', async () => {
		const editor = makeEditor('hello world', 0, 0);

		// Simulate real VS Code: setting editor.selection synchronously fires
		// onDidChangeTextEditorSelection (allowing nextWord to update lastOffset).
		let m_selValue = editor.selection;
		Object.defineProperty(editor, 'selection', {
			get: () => m_selValue,
			set: (sel: Selection) => {
				m_selValue = sel;
				const evt = { selections: [sel], textEditor: editor };
				m_eventHandlers.onDidChangeTextEditorSelection.forEach(h => h(evt));
			},
			configurable: true,
		});

		// Simulate real VS Code: editor.edit fires onDidChangeTextDocument and a
		// post-edit onDidChangeTextEditorSelection synchronously before the Promise
		// resolves — both happen BEFORE MacroCommand.push(deleteWord) is called.
		const origEdit = (editor as any).edit.bind(editor);
		(editor as any).edit = (callback: any, options: any) => {
			const p = origEdit(callback, options);
			// onDidChangeTextDocument fires synchronously during edit application
			fireDocChangeEvent('', 0, 6);  // 'hello ' (6 chars) deleted at offset 0
			// Post-edit: cursor returns to (0,0)
			fireSelectionEvent(editor, new Position(0, 0));
			return p;
		};

		await startRecording(editor);
		await callCommand('deleteWord', editor);
		await stopRecording(editor);

		// Restore patches
		delete (editor as any).edit;
		Object.defineProperty(editor, 'selection', { value: m_selValue, writable: true, configurable: true });

		const replayEditor = makeEditor('hello world', 0, 0);
		await replay(replayEditor);
		assert.strictEqual(
			replayEditor.document.getText(),
			'world',
			`Expected 'world' but got '${replayEditor.document.getText()}'`
		);
	});
});

// ============================================================
// Recording control (uses push() — sets cmdTime)
// ============================================================

describe('MacroCommand: recording control', () => {
	it('push() adds to replay list only while recording', async () => {
		const editor = makeEditor('');

		let m_calledBefore = false;
		MacroCommand.push(() => { m_calledBefore = true; });   // not recording

		await startRecording(editor);
		let m_calledDuring = false;
		MacroCommand.push(() => { m_calledDuring = true; });   // recording

		await stopRecording(editor);
		let m_calledAfter = false;
		MacroCommand.push(() => { m_calledAfter = true; });    // not recording

		await replay(editor);
		assert.strictEqual(m_calledBefore, false, 'before recording: should not be replayed');
		assert.strictEqual(m_calledDuring, true,  'during recording: should be replayed');
		assert.strictEqual(m_calledAfter,  false, 'after recording:  should not be replayed');
	});

	it('starting a new recording clears the previous list', async () => {
		const editor = makeEditor('');

		await startRecording(editor);
		let m_firstCalled = false;
		MacroCommand.push(() => { m_firstCalled = true; });
		await stopRecording(editor);

		// Second recording: must reset the list
		await startRecording(editor);
		let m_secondCalled = false;
		MacroCommand.push(() => { m_secondCalled = true; });
		await stopRecording(editor);

		await replay(editor);
		assert.strictEqual(m_firstCalled, false, 'first recording list should be cleared');
		assert.strictEqual(m_secondCalled, true,  'second recording list should be replayed');
	});

	it('macroReplay does nothing while recording is active', async () => {
		const editor = makeEditor('');
		await startRecording(editor);
		let m_called = false;
		MacroCommand.push(() => { m_called = true; });

		// Replay while still recording — should be a no-op
		await replay(editor);
		assert.strictEqual(m_called, false, 'replay must be ignored while recording');

		await stopRecording(editor);
	});

	it('changing active editor stops recording', async () => {
		const editor = makeEditor('');
		await startRecording(editor);

		fireActiveEditorChange();
		m_isRecording = false;   // mirror the internal state change

		let m_called = false;
		MacroCommand.push(() => { m_called = true; });   // recording is off now
		await replay(editor);
		assert.strictEqual(m_called, false, 'push after editor change should not be recorded');
	});
});

// ============================================================
// Replay behaviour (uses push())
// ============================================================

describe('MacroCommand: replay behaviour', () => {
	it('replays a single internal function', async () => {
		const editor = makeEditor('');
		await startRecording(editor);
		let m_callCount = 0;
		MacroCommand.push(() => { m_callCount++; });
		await stopRecording(editor);

		await replay(editor);
		assert.strictEqual(m_callCount, 1);
	});

	it('replays multiple functions in recorded order', async () => {
		const editor = makeEditor('');
		await startRecording(editor);
		const m_order: number[] = [];
		MacroCommand.push(() => { m_order.push(1); });
		MacroCommand.push(() => { m_order.push(2); });
		MacroCommand.push(() => { m_order.push(3); });
		await stopRecording(editor);

		await replay(editor);
		assert.deepStrictEqual(m_order, [1, 2, 3]);
	});

	it('can replay the same recorded list multiple times', async () => {
		const editor = makeEditor('');
		await startRecording(editor);
		let m_callCount = 0;
		MacroCommand.push(() => { m_callCount++; });
		await stopRecording(editor);

		await replay(editor);
		await replay(editor);
		assert.strictEqual(m_callCount, 2);
	});
});
