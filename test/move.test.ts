'use strict';

import * as assert from 'assert';
import { MockTextDocument, MockTextEditor, Position, Selection } from './mock/vscode';

// Import after mock is registered via tsconfig paths
import { MoveCommand } from '../src/move';

// ---- Helpers ----

function makeEditor(text: string, line: number, character: number): MockTextEditor {
	const doc = new MockTextDocument(text);
	const editor = new MockTextEditor(doc);
	editor.setCursor(line, character);
	return editor;
}

function cursorPos(editor: MockTextEditor): { line: number; character: number } {
	return { line: editor.selection.active.line, character: editor.selection.active.character };
}

// ---- nextWord tests ----

describe('MoveCommand.nextWord', () => {
	it('moves past a lowercase word', () => {
		// cursor at start of "hello"
		const editor = makeEditor('hello world', 0, 0);
		MoveCommand.nextWord(editor);
		// "hello" consumed, then trailing spaces consumed → lands at "world"
		assert.deepStrictEqual(cursorPos(editor), { line: 0, character: 6 });
	});

	it('moves past an uppercase-leading word', () => {
		// cursor at start of "Hello"
		const editor = makeEditor('Hello world', 0, 0);
		MoveCommand.nextWord(editor);
		// "Hello" = [A-Z][a-z]* → length 5, then space → character 6
		assert.deepStrictEqual(cursorPos(editor), { line: 0, character: 6 });
	});

	it('moves past a sequence of digits', () => {
		const editor = makeEditor('123 abc', 0, 0);
		MoveCommand.nextWord(editor);
		// digits consumed, space consumed → "abc" starts at 4
		assert.deepStrictEqual(cursorPos(editor), { line: 0, character: 4 });
	});

	it('moves past an underscore-prefixed identifier', () => {
		const editor = makeEditor('_myVar next', 0, 0);
		MoveCommand.nextWord(editor);
		// "_myVar" consumed → length 6, then space → 7
		assert.deepStrictEqual(cursorPos(editor), { line: 0, character: 7 });
	});

	it('moves past spaces when cursor is on whitespace', () => {
		const editor = makeEditor('  hello', 0, 0);
		MoveCommand.nextWord(editor);
		// spaces are not consumed by word regexp but by trailing space regexp
		assert.deepStrictEqual(cursorPos(editor), { line: 0, character: 2 });
	});

	it('moves to next line when at end of current line', () => {
		const editor = makeEditor('hello\nworld', 0, 5); // end of "hello"
		MoveCommand.nextWord(editor);
		assert.deepStrictEqual(cursorPos(editor), { line: 1, character: 0 });
	});

	it('moves within the second word on a line', () => {
		const editor = makeEditor('foo bar baz', 0, 4); // start of "bar"
		MoveCommand.nextWord(editor);
		// "bar" → 3 chars, space → 1 char → lands at "baz" (character 8)
		assert.deepStrictEqual(cursorPos(editor), { line: 0, character: 8 });
	});
});

// ---- prevWord tests ----

describe('MoveCommand.prevWord', () => {
	it('moves back to the start of the current word', () => {
		const editor = makeEditor('hello world', 0, 11); // end of "world"
		MoveCommand.prevWord(editor);
		// back past "world" → lands at character 6
		assert.deepStrictEqual(cursorPos(editor), { line: 0, character: 6 });
	});

	it('moves back past spaces and then the previous word', () => {
		const editor = makeEditor('hello world', 0, 6); // start of "world" (after space)
		MoveCommand.prevWord(editor);
		// back past space, then back past "hello" → character 0
		assert.deepStrictEqual(cursorPos(editor), { line: 0, character: 0 });
	});

	it('moves to previous line when at column 0', () => {
		const editor = makeEditor('hello\nworld', 1, 0);
		MoveCommand.prevWord(editor);
		// moves to end of previous line
		assert.deepStrictEqual(cursorPos(editor), { line: 0, character: 5 });
	});

	it('moves back past uppercase word', () => {
		const editor = makeEditor('Foo Bar', 0, 7); // end of "Bar"
		MoveCommand.prevWord(editor);
		assert.deepStrictEqual(cursorPos(editor), { line: 0, character: 4 });
	});

	it('moves back past digits', () => {
		const editor = makeEditor('abc 123', 0, 7); // end of "123"
		MoveCommand.prevWord(editor);
		assert.deepStrictEqual(cursorPos(editor), { line: 0, character: 4 });
	});

	it('moves back twice to walk through multiple words', () => {
		const editor = makeEditor('one two three', 0, 13); // end
		MoveCommand.prevWord(editor);
		assert.deepStrictEqual(cursorPos(editor), { line: 0, character: 8 }); // start of "three"
		MoveCommand.prevWord(editor);
		assert.deepStrictEqual(cursorPos(editor), { line: 0, character: 4 }); // start of "two"
		MoveCommand.prevWord(editor);
		assert.deepStrictEqual(cursorPos(editor), { line: 0, character: 0 }); // start of "one"
	});
});

// ---- mark / swapMark / gotoMark are integration-level; basic smoke tests ----

describe('MoveCommand (mark)', () => {
	it('nextWord is exposed as a public method and moves cursor', () => {
		const editor = makeEditor('camelCase value', 0, 0);
		// MoveCommand.nextWord is the public wrapper (no macro push)
		MoveCommand.nextWord(editor);
		// "camel" → type 'a', regexp /^[a-z]+/ matches "camel", then no space → character 5
		assert.strictEqual(editor.selection.active.character, 5);
	});

	it('nextWord sets a collapsed selection (anchor === active)', () => {
		const editor = makeEditor('hello world', 0, 0);
		// Give it a non-collapsed selection first
		editor.selection = new Selection(new Position(0, 0), new Position(0, 3));
		MoveCommand.nextWord(editor);
		const sel = editor.selection;
		assert.ok(sel.anchor.isEqual(sel.active), 'selection should be collapsed after nextWord');
	});
});
