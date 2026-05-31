'use strict';

// ---- Core value types ----

export class Position {
	constructor(public readonly line: number, public readonly character: number) {}

	translate(lineDelta: number = 0, characterDelta: number = 0): Position {
		return new Position(this.line + lineDelta, this.character + characterDelta);
	}

	isEqual(other: Position): boolean {
		return this.line === other.line && this.character === other.character;
	}

	isBefore(other: Position): boolean {
		if (this.line !== other.line) {
			return this.line < other.line;
		}
		return this.character < other.character;
	}

	isBeforeOrEqual(other: Position): boolean {
		return this.isEqual(other) || this.isBefore(other);
	}

	isAfter(other: Position): boolean {
		return !this.isBeforeOrEqual(other);
	}

	isAfterOrEqual(other: Position): boolean {
		return !this.isBefore(other);
	}

	compareTo(other: Position): number {
		if (this.line !== other.line) {
			return this.line - other.line;
		}
		return this.character - other.character;
	}
}

export class Range {
	public readonly start: Position;
	public readonly end: Position;

	constructor(start: Position, end: Position) {
		if (start.isBeforeOrEqual(end)) {
			this.start = start;
			this.end = end;
		} else {
			this.start = end;
			this.end = start;
		}
	}

	get isEmpty(): boolean {
		return this.start.isEqual(this.end);
	}

	contains(posOrRange: Position | Range): boolean {
		if (posOrRange instanceof Position) {
			return this.start.isBeforeOrEqual(posOrRange) && posOrRange.isBeforeOrEqual(this.end);
		}
		return this.start.isBeforeOrEqual(posOrRange.start) && posOrRange.end.isBeforeOrEqual(this.end);
	}
}

export class Selection extends Range {
	public readonly anchor: Position;
	public readonly active: Position;

	constructor(anchor: Position, active: Position) {
		super(anchor, active);
		this.anchor = anchor;
		this.active = active;
	}

	get isReversed(): boolean {
		return this.anchor.isAfter(this.active);
	}
}

// ---- Enums ----

export enum TextEditorRevealType {
	Default = 0,
	InCenter = 1,
	InCenterIfOutsideViewport = 2,
	AtTop = 3,
}

export enum StatusBarAlignment {
	Left = 1,
	Right = 2,
}

// ---- Mock TextLine ----

export interface TextLine {
	text: string;
	range: Range;
	rangeIncludingLineBreak: Range;
	firstNonWhitespaceCharacterIndex: number;
}

// ---- Mock TextDocument ----

export class MockTextDocument {
	private m_lines: string[];
	public fileName: string;

	constructor(text: string, fileName: string = 'test.ts') {
		this.m_lines = text.split('\n');
		this.fileName = fileName;
	}

	get lineCount(): number {
		return this.m_lines.length;
	}

	lineAt(posOrLine: Position | number): TextLine {
		const lineNum = posOrLine instanceof Position ? posOrLine.line : posOrLine;
		const text = this.m_lines[lineNum] ?? '';
		const start = new Position(lineNum, 0);
		const end = new Position(lineNum, text.length);
		const range = new Range(start, end);
		return {
			text,
			range,
			rangeIncludingLineBreak: new Range(start, new Position(lineNum, text.length + 1)),
			firstNonWhitespaceCharacterIndex: text.search(/\S/) >= 0 ? text.search(/\S/) : text.length,
		};
	}

	getText(range?: Range): string {
		if (!range) {
			return this.m_lines.join('\n');
		}
		if (range.start.line === range.end.line) {
			return this.m_lines[range.start.line].slice(range.start.character, range.end.character);
		}
		const parts: string[] = [];
		parts.push(this.m_lines[range.start.line].slice(range.start.character));
		for (let i = range.start.line + 1; i < range.end.line; i++) {
			parts.push(this.m_lines[i]);
		}
		parts.push(this.m_lines[range.end.line].slice(0, range.end.character));
		return parts.join('\n');
	}

	offsetAt(pos: Position): number {
		let offset = 0;
		for (let i = 0; i < pos.line; i++) {
			offset += this.m_lines[i].length + 1; // +1 for '\n'
		}
		return offset + pos.character;
	}

	positionAt(offset: number): Position {
		let remaining = offset;
		for (let i = 0; i < this.m_lines.length; i++) {
			if (remaining <= this.m_lines[i].length) {
				return new Position(i, remaining);
			}
			remaining -= this.m_lines[i].length + 1;
		}
		const lastLine = this.m_lines.length - 1;
		return new Position(lastLine, this.m_lines[lastLine].length);
	}

	getWordRangeAtPosition(pos: Position): Range | undefined {
		const text = this.m_lines[pos.line];
		if (!text) {
			return undefined;
		}
		const wordRe = /[A-Za-z0-9_]+/g;
		let m: RegExpExecArray | null;
		while ((m = wordRe.exec(text)) !== null) {
			if (m.index <= pos.character && pos.character <= m.index + m[0].length) {
				return new Range(new Position(pos.line, m.index), new Position(pos.line, m.index + m[0].length));
			}
		}
		return undefined;
	}

	// Mutates document: apply a delete then insert at the same start position (replace)
	applyEdits(edits: Array<{ type: 'delete'; range: Range } | { type: 'insert'; pos: Position; text: string }>): void {
		// Sort by offset descending so earlier edits don't shift later positions
		const sorted = [...edits].sort((a, b) => {
			const aOff = a.type === 'delete' ? this.offsetAt(a.range.start) : this.offsetAt(a.pos);
			const bOff = b.type === 'delete' ? this.offsetAt(b.range.start) : this.offsetAt(b.pos);
			return bOff - aOff;
		});

		let fullText = this.m_lines.join('\n');
		for (const edit of sorted) {
			if (edit.type === 'delete') {
				const start = this.offsetAt(edit.range.start);
				const end = this.offsetAt(edit.range.end);
				fullText = fullText.slice(0, start) + fullText.slice(end);
			} else {
				const off = this.offsetAt(edit.pos);
				fullText = fullText.slice(0, off) + edit.text + fullText.slice(off);
			}
			// Rebuild offset map after each edit
			this.m_lines = fullText.split('\n');
		}
		this.m_lines = fullText.split('\n');
	}
}

// ---- Mock TextEditorEdit ----

class MockTextEditorEdit {
	public readonly edits: Array<{ type: 'delete'; range: Range } | { type: 'insert'; pos: Position; text: string }> = [];

	delete(range: Range): void {
		this.edits.push({ type: 'delete', range });
	}

	insert(pos: Position, text: string): void {
		this.edits.push({ type: 'insert', pos, text });
	}

	replace(range: Range, text: string): void {
		this.edits.push({ type: 'delete', range });
		this.edits.push({ type: 'insert', pos: range.start, text });
	}
}

// ---- Mock TextEditor ----

export class MockTextEditor {
	public selection: Selection;
	public document: MockTextDocument;

	constructor(document: MockTextDocument, pos?: Position) {
		this.document = document;
		const p = pos ?? new Position(0, 0);
		this.selection = new Selection(p, p);
	}

	setCursor(line: number, character: number): void {
		const p = new Position(line, character);
		this.selection = new Selection(p, p);
	}

	edit(
		callback: (editBuilder: MockTextEditorEdit) => void,
		_options?: { undoStopBefore?: boolean; undoStopAfter?: boolean }
	): Promise<boolean> {
		const builder = new MockTextEditorEdit();
		callback(builder);
		this.document.applyEdits(builder.edits);
		return Promise.resolve(true);
	}

	revealRange(_range: Range, _revealType?: TextEditorRevealType): void {
		// no-op in mock
	}
}

// ---- Global mock state ----

let m_clipboardText = '';

const m_eventHandlers = {
	onDidChangeActiveTextEditor: [] as Array<(e: unknown) => unknown>,
	onDidChangeTextEditorSelection: [] as Array<(e: unknown) => unknown>,
	onDidChangeTextDocument: [] as Array<(e: unknown) => unknown>,
	onDidCloseTextDocument: [] as Array<(e: unknown) => unknown>,
};

// ---- vscode namespace mocks ----

export const commands = {
	executeCommand: (_command: string, ..._args: unknown[]): Thenable<unknown> => {
		return Promise.resolve(undefined);
	},
	registerCommand: (_command: string, _callback: (...args: unknown[]) => unknown): { dispose(): void } => {
		return { dispose() {} };
	},
	getCommands: (): Thenable<string[]> => Promise.resolve([]),
};

export const env = {
	clipboard: {
		writeText(text: string): Thenable<void> {
			m_clipboardText = text;
			return Promise.resolve();
		},
		readText(): Thenable<string> {
			return Promise.resolve(m_clipboardText);
		},
	},
};

export const window = {
	activeTextEditor: undefined as MockTextEditor | undefined,

	createStatusBarItem(_alignment?: StatusBarAlignment, _priority?: number) {
		return { text: '', show() {}, hide() {}, dispose() {} };
	},

	showQuickPick(items: string[]): Thenable<string | undefined> {
		return Promise.resolve(items[0]);
	},

	showTextDocument(_doc: MockTextDocument): Thenable<MockTextEditor> {
		return Promise.resolve(new MockTextEditor(_doc));
	},

	onDidChangeActiveTextEditor(handler: (e: unknown) => unknown): { dispose(): void } {
		m_eventHandlers.onDidChangeActiveTextEditor.push(handler);
		return { dispose() {} };
	},

	onDidChangeTextEditorSelection(handler: (e: unknown) => unknown): { dispose(): void } {
		m_eventHandlers.onDidChangeTextEditorSelection.push(handler);
		return { dispose() {} };
	},
};

export const workspace = {
	openTextDocument(_path: string): Thenable<MockTextDocument> {
		return Promise.resolve(new MockTextDocument(''));
	},

	onDidChangeTextDocument(handler: (e: unknown) => unknown): { dispose(): void } {
		m_eventHandlers.onDidChangeTextDocument.push(handler);
		return { dispose() {} };
	},

	onDidCloseTextDocument(handler: (e: unknown) => unknown): { dispose(): void } {
		m_eventHandlers.onDidCloseTextDocument.push(handler);
		return { dispose() {} };
	},
};

// ---- Type aliases for compatibility with source files ----
export type TextEditor = MockTextEditor;
export type TextDocument = MockTextDocument;
export type ExtensionContext = { subscriptions: { dispose(): void }[] };

// ---- Test helpers exposed from mock ----

export const mockHelpers = {
	setClipboard(text: string) {
		m_clipboardText = text;
	},
	getClipboard(): string {
		return m_clipboardText;
	},
	getEventHandlers() {
		return m_eventHandlers;
	},
};
