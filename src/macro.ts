'use strict';

/**
 * Macro command with recording and playing
 */

import * as vscode from 'vscode';
import { CommandActivator } from './command';
import { EditCommand } from './edit';

enum Command {
	Internal,
	CursorLeft,
	CursorRight,
	WordLeft,
	WordRight,
	LineTop,
	LineEnd,
	Insert,
	Delete
}

class CommandArgs {
	select: boolean = false;
	text: string = '';
	offset: number = 0;
	internal?: InternalFunction;
	async: boolean = false;
}

// temporary store of number of indent characters when execute lineBreakInsert
let indentDepth : number = 0;

type ReplayFunction = (editor: vscode.TextEditor, command: Command, arg: CommandArgs) => Thenable<void>;
type InternalFunctionVoid = (editor: vscode.TextEditor) => void;
type InternalFunctionAsync = (editor: vscode.TextEditor) => Thenable<unknown>;
type InternalFunction = InternalFunctionVoid | InternalFunctionAsync;

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

	setFunction(internal: InternalFunction, async: boolean) {
		this.arg.internal = internal;
		this.arg.async = async;
	}

	execute(editor: vscode.TextEditor) {
		//console.log('replay: ', this.command, this.arg);
		return this.func(editor, this.command, this.arg);
	}
}

function replayMove(editor: vscode.TextEditor, mode : Command, arg: CommandArgs) : Thenable<void> {
	return new Promise<void>((resolve, reject) => {

		let cmdName = '';
		switch (mode) {
			case Command.CursorLeft:
				cmdName = 'cursorLeft';
				break;
			case Command.CursorRight:
				cmdName = 'cursorRight';
				break;
			case Command.WordLeft:
				cmdName = 'cursorWordLeft';
				break;
			case Command.WordRight:
				cmdName = 'cursorWordEndRight';
				break;
			case Command.LineTop:
				cmdName = 'cursorHome';
				break;
			case Command.LineEnd:
				cmdName = 'cursorEnd';
				break;
		}

		if (arg.select) {
			cmdName += 'Select;'
		}
		vscode.commands.executeCommand(cmdName).then((value) => resolve(), reject);
	});
}

function replayEdit(editor: vscode.TextEditor, mode: Command, arg: CommandArgs): Thenable<void> {
	return new Promise<void>((resolve, reject) => {
		//console.log('replayEdit', mode, arg.offset, arg.text);
		let active = editor.selection.active;
		switch (mode) {
			case Command.Insert:
				if (arg.text.startsWith('\n') || arg.text.startsWith('\r')) {
					vscode.commands.executeCommand('lineBreakInsert').then(() => {
						active = new vscode.Position(active.line + 1, indentDepth);
						editor.selection = new vscode.Selection(active, active);
						resolve();
					});
				} else {
					EditCommand.edit(editor, (edit) => {
						edit.insert(active, arg.text);
					}).then(() => {
						active = active.translate(0, arg.offset)
						editor.selection = new vscode.Selection(active, active);
						resolve();
					}, reject);
				}
				break;
			case Command.Delete:
				const offset = editor.document.offsetAt(active) + arg.offset;
				const start = editor.document.positionAt(offset);
				const end = editor.document.positionAt(offset + 1);
				EditCommand.edit(editor, (edit) => {
					edit.delete(new vscode.Range(start, end));
				}).then(() => {
					editor.selection = new vscode.Selection(start, start);
					resolve();
				}, reject);
				break;
			default:
				reject('invalid command mode');
				break;
		}
	});
}

function replayInternalCommand(editor: vscode.TextEditor, mode: Command, arg: CommandArgs): Thenable<void> {
	if (arg.async) {
		if (arg.internal) {
			return arg.internal(editor) as Thenable<void>;
		} else {
			return new Promise<void>((resolve, reject) => {
				reject('execute undefined function');
			});
		}
	} else {
		return new Promise<void>((resolve, reject) => {
			if (arg.internal) {
				arg.internal(editor);
				resolve();
			} else {
				reject('execute undefined function');
			}
		});
	}
}

export let MacroCommand = (function (){
	let recording = false;
	let cmdTime = 0;
	let lastSelection: vscode.Selection | null = null;
	let lastOffset : number = 0;
	let doEdit = false;
	let list: MacroStore[] = [];

	/*
	vscode.commands.getCommands().then((value) => {
		value.forEach((item) => {
			if (/cursor/.test(item)) {
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
			indentDepth = event.contentChanges[0].text.length - 1;
		}
		if (recording) {
			pushEdit(event);
		}
	});

	let item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
	item.text = 'Macro';

	function pushCommand(func: InternalFunction, async: boolean) {
		cmdTime = Date.now();
		const cmd = new MacroStore(replayInternalCommand);
		cmd.setFunction(func, async);
		list.push(cmd);
	}

	function isEol(document: vscode.TextDocument, offset: number) {
		return "\n\r".indexOf(document.getText().charAt(offset)) >= 0;
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
				if (delta != 0) {
					const last = list[list.length - 1];
					last.setOffset(delta);
				}
				doEdit = false;
				return;
			}

			let cmd: MacroStore | null = null;
			if (offset == lastOffset + 1 || (offset == lastOffset + 2 && isEol(document, lastOffset))) {
				//console.log('cursor right');
				cmd = new MacroStore(replayMove, Command.CursorRight);
			} else if (offset == lastOffset - 1 || (offset == lastOffset - 2 && isEol(document, offset))) {
				//console.log('cursor left');
				cmd = new MacroStore(replayMove, Command.CursorLeft);
			} else if (offset > lastOffset && wordRange && wordRange.end.isEqual(active)) {
				//console.log("word right");
				cmd = new MacroStore(replayMove, Command.WordRight);
			} else if (offset < lastOffset && wordRange && wordRange.start.isEqual(active)) {
				//console.log("word left");
				cmd = new MacroStore(replayMove, Command.WordLeft);
			} else if (active.line == lastSelection.active.line) {
				let textLine = document.lineAt(active);
				if (active.character == textLine.firstNonWhitespaceCharacterIndex) {
					//console.log('cursor line top');
					cmd = new MacroStore(replayMove, Command.LineTop);
				} else if (active.isEqual(textLine.range.end)) {
					//console.log('cursor line end');
					cmd = new MacroStore(replayMove, Command.LineEnd);
				}
			}
			if (cmd) {
				if (anchor.isEqual(active) == false) {
					cmd.withSelect();
				}
				list.push(cmd);
			}
		}
	}

	function pushEdit(event: vscode.TextDocumentChangeEvent) {
		let changes = event.contentChanges;
		if (Date.now() - cmdTime > 100 && changes[0]) {
			const change = changes[0];
			if (change.text != '') {
				//console.log('insert', change.rangeOffset, change.text);
				const cmd = new MacroStore(replayEdit, Command.Insert);
				cmd.setText(change.text);
				list.push(cmd);
				doEdit = true;
			} else if (change.rangeLength > 0 && change.text == '') {
				//console.log('delete', change.rangeOffset, change.rangeLength);
				list.push(new MacroStore(replayEdit, Command.Delete));
				doEdit = true;
			}
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

	async function macroReplay(editor: vscode.TextEditor) {
		//console.log('play', list.length);
		if (recording) {
			return;
		}

		EditCommand.startUndoFusion();
		for (let i = 0; i < list.length; i++) {
			await list[i].execute(editor);
		}
		EditCommand.stopUndoFution();
	}

	return {
		activate: (context: vscode.ExtensionContext) => {
			CommandActivator.register(context, [macroRecord, macroReplay]);
		},
		push: (func: InternalFunctionVoid) => {
			if (recording) {
				pushCommand(func, CommandActivator.isAsync(func.name));
			}
		},
	};

})();
