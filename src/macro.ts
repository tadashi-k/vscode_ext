'use strict';

/**
 * Macro command with recording and playing
 */

import * as vscode from 'vscode';
import { CommandActivator } from './command';

enum Command {
	Internal,
	CursorLeft,
	CursorRight,
	WordLeft,
	WordRight,
	LineTop,
	LineEnd,
	LineUp,
	LineDown,
	Insert,
	Delete
}

class CommandArgs {
	select: boolean = false;
	text: string = '';
	offset: number = 0;
}

type ReplayFunction = (editor: vscode.TextEditor, command: Command, arg: CommandArgs) => void;

class MacroStore {
	func: ReplayFunction;
	command: Command;
	arg: CommandArgs;

	constructor(func: ReplayFunction, command?: Command) {
		this.func = func;
		this.command = command || Command.Internal;
		this.arg = new CommandArgs;
	}

	withSelect() {
		this.arg.select = true;
	}

	setText(text: string) {
		this.arg.text = text;
	}

	setOffset(offset: number) {
		this.arg.offset = offset;
	}

	execute(editor: vscode.TextEditor) {
		//console.log('replay: ', this.command, this.arg);
		this.func(editor, this.command, this.arg);
	}
}

function replayMove(editor: vscode.TextEditor, mode : Command, arg: CommandArgs) {
	let active = editor.selection.active;
	const anchor = editor.selection.anchor;
	const offset = editor.document.offsetAt(active);
	const isSelect = arg.select;

	let wordRange : vscode.Range | undefined;
	let textLine : vscode.TextLine;

	switch (mode) {
		case Command.CursorLeft:
			active = editor.document.positionAt(offset - 1);
			break;
		case Command.CursorRight:
			active = editor.document.positionAt(offset + 1);
			break;
		case Command.WordLeft:
			active = editor.document.positionAt(offset - 1);
			wordRange = editor.document.getWordRangeAtPosition(active);
			if (wordRange) {
				active = wordRange.start;
			}
			break;
		case Command.WordRight: 
			active = editor.document.positionAt(offset + 1);
			wordRange = editor.document.getWordRangeAtPosition(active);
			if (wordRange) {
				active = wordRange.end;
			}
			break;
		case Command.LineTop:
			textLine = editor.document.lineAt(active);
			active = new vscode.Position(active.line, textLine.firstNonWhitespaceCharacterIndex);
			break;
		case Command.LineEnd:
			textLine = editor.document.lineAt(active);
			active = textLine.range.end;
			break;
		case Command.LineUp:
			if (arg) {
				vscode.commands.executeCommand('cursorUpSelect');
			} else {
				vscode.commands.executeCommand('cursorUp');
			}
			return;
		case Command.LineDown:
			if (arg) {
				vscode.commands.executeCommand('cursorDownSelect');
			} else {
				vscode.commands.executeCommand('cursorDown');
			}
			return;
	}

	editor.selection = new vscode.Selection(active, isSelect ? anchor : active);
}

export let MacroCommand = (function (){
	let recording = false;
	let cmdTime = 0;
	let lastSelection: vscode.Selection | null = null;
	let lastOffset : number = 0;
	let lastChangeLength: number = 0;
	let doEdit = false;
	let list: MacroStore[] = [];

	/*
	vscode.commands.getCommands().then((value) => {
		value.forEach((item) => {
			if (/line/.test(item)) {
				console.log(item);
			}
		});
	});
	*/

	vscode.window.onDidChangeActiveTextEditor((event) => {
		lastSelection = null;
		if (recording) {
			recordStop();
		}
	});

	vscode.window.onDidChangeTextEditorSelection((event) => {
		if (recording) {
			pushMove(event);
		}
		if (event.selections[0]) {
			lastSelection = event.selections[0];
			lastOffset = event.textEditor.document.offsetAt(lastSelection.active)
		} else {
			lastSelection = null;
		}
	});

	vscode.workspace.onDidChangeTextDocument((event) => {
		if (event.contentChanges[0]) {
			lastChangeLength = event.contentChanges[0].text.length;
		}
		if (recording) {
			pushEdit(event);
		}
	});

	let item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
	item.text = 'Macro';

	function replayEdit(editor: vscode.TextEditor, mode : Command, arg: CommandArgs) {
		console.log('replayEdit', mode, arg.offset, arg.text);
		let active = editor.selection.active;
		switch(mode) {
			case Command.Insert:
				if (arg.text.startsWith('\n') || arg.text.startsWith('\r')) {
					vscode.commands.executeCommand('lineBreakInsert').then(() => {
						if (lastChangeLength > 0) {
							active = new vscode.Position(active.line + 1, lastChangeLength - 1);
							editor.selection = new vscode.Selection(active, active);
						}
					});
				} else {
					editor.edit((edit: vscode.TextEditorEdit) => {
						edit.insert(active, arg.text);
					});
					active = active.translate(0, arg.offset)
					editor.selection = new vscode.Selection(active, active);
				}
				break;
			case Command.Delete:
				editor.edit((edit: vscode.TextEditorEdit) => {
					const offset = editor.document.offsetAt(active) + arg.offset;
					const start = editor.document.positionAt(offset);
					const end = editor.document.positionAt(offset + 1);
					edit.delete(new vscode.Range(start, end));
					editor.selection = new vscode.Selection(start, start);
				});
				break;
		}
	}

	function pushCommand(func: (editor: vscode.TextEditor) => void) {
		cmdTime = Date.now();
		console.log('store command', func.name);
		list.push(new MacroStore(func));
	}

	function pushMove(event : vscode.TextEditorSelectionChangeEvent) {
		let selections = event.selections;
		if (Date.now() - cmdTime > 100 && selections[0] && lastSelection) {
			const document = event.textEditor.document;
			const active = selections[0].active;
			const anchor = selections[0].anchor;
			const offset = document.offsetAt(active);
			const wordRange = document.getWordRangeAtPosition(lastSelection.active);

			if (doEdit) {
				const delta = offset - lastOffset;
				console.log('delta', delta);
				if (delta != 0) {
					const last = list[list.length - 1];
					last.setOffset(delta);
				}
				doEdit = false;
				return;
			}

			//console.log(active.character);

			let cmd: MacroStore | null = null;
			if (offset == lastOffset + 1) {
				console.log('cursor right');
				cmd = new MacroStore(replayMove, Command.CursorRight);
			} else if (offset == lastOffset - 1) {
				console.log('cursor left');
				cmd = new MacroStore(replayMove, Command.CursorLeft);
			} else if (offset > lastOffset && wordRange && wordRange.end.isEqual(active)) {
				console.log("word right");
				cmd = new MacroStore(replayMove, Command.WordRight);
			} else if (offset < lastOffset && wordRange && wordRange.start.isEqual(active)) {
				console.log("word left");
				cmd = new MacroStore(replayMove, Command.WordLeft);
			} else if (active.line == lastSelection.active.line) {
				let textLine = document.lineAt(active);
				if (active.character == textLine.firstNonWhitespaceCharacterIndex) {
					console.log('cursor line top');
					cmd = new MacroStore(replayMove, Command.LineTop);
				} else if (active.isEqual(textLine.range.end)) {
					console.log('cursor line end');
					cmd = new MacroStore(replayMove, Command.LineEnd);
				}
			} else if (active.line == lastSelection.active.line + 1) {
				console.log('cursor down', active.line, lastSelection.active.line);
				cmd = new MacroStore(replayMove, Command.LineDown);
			} else if (active.line == lastSelection.active.line - 1) {
				console.log('cursor up', active.line, lastSelection.active.line);
				cmd = new MacroStore(replayMove, Command.LineUp);
			}
			if (cmd) {
				if (anchor.isEqual(active) == false) {
					cmd.withSelect();
					console.log('with select');
				}
				list.push(cmd);
			}
			//console.log('move', selections[0].active.line, selections[0].active.character);
		}
	}

	function pushEdit(event: vscode.TextDocumentChangeEvent) {
		let changes = event.contentChanges;
		if (Date.now() - cmdTime > 100 && changes[0]) {
			const change = changes[0];
			if (change.text != '') {
				console.log('insert', change.rangeOffset, change.text);
				const cmd = new MacroStore(replayEdit, Command.Insert);
				cmd.setText(change.text);
				list.push(cmd);
				doEdit = true;
			} else if (change.rangeLength > 0 && change.text == '') {
				console.log('delete', change.rangeOffset, change.rangeLength);
				list.push(new MacroStore(replayEdit, Command.Delete));
				doEdit = true;
			}
			//console.log('store edit', change.rangeOffset, change.rangeLength, change.text);
		}
	}

	function recordStart() {
		recording = true;
		list = [];
		item.show();
	}

	function recordStop() {
		recording = false;
		item.hide();
	}

	function macroRecord(editor : vscode.TextEditor) {
		if (recording) {
			recordStop();
		} else {
			recordStart();
		}
	}

	function macroReplay(editor: vscode.TextEditor) {
		console.log('play', list.length);
		list.forEach((cmd) => {
			cmd.execute(editor);
		});
	}

	return {
		activate: (context: vscode.ExtensionContext) => {
			CommandActivator.register(context, [macroRecord, macroReplay]);
		},
		push: (func : (editor: vscode.TextEditor)=>void) => {
			if (recording) {
				pushCommand(func);
			}
		}
	};

})();
