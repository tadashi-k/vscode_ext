'use strict';

import * as vscode from 'vscode';

export function activateEditorExt(context: vscode.ExtensionContext) {
	var yankString: string;
	var yankLine: number = -1;
	var yankStartOfLine: boolean = false;

	function deleteLine() {
		let editor = vscode.window.activeTextEditor;
		if (!editor) {
			return;
		}

		let document = editor.document;
		let linePos = document.lineAt(editor.selection.active).range.start;
		let range = new vscode.Range(linePos, linePos.translate(1));

		let line = document.getText(range);

		if (linePos.line === yankLine) {
			yankString += line;
		} else {
			yankString = line;
			yankStartOfLine = true;
		}
		yankLine = linePos.line;

		editor.edit((edit: vscode.TextEditorEdit) => {
			edit.delete(range);
		});
	}

	function deleteEndOfLine() {
		let editor = vscode.window.activeTextEditor;
		if (!editor) {
			return;
		}

		let document = editor.document;
		let pos = editor.selection.active;
		let lineEnd = document.lineAt(editor.selection.active).range.end;
		let range = new vscode.Range(pos, lineEnd);

		yankString = document.getText(range);
		yankStartOfLine = false;
		yankLine = -1;

		editor.edit((edit: vscode.TextEditorEdit) => {
			edit.delete(range);
		});
	}

	function yank() {
		// The code you place here will be executed every time your command is executed
		let editor = vscode.window.activeTextEditor;
		if (!editor) {
			return;
		}

		let selection = editor.selection;
		let document = editor.document;
		var yankPos: vscode.Position;

		if (yankStartOfLine) {
			yankPos = document.lineAt(selection.active).range.start;
		} else {
			yankPos = selection.active;
		}

		editor.edit((edit: vscode.TextEditorEdit) => {
			edit.insert(yankPos, yankString);
		});
	}

	function registerCommand(context: vscode.ExtensionContext, name: string, callback: () => void) {
		let disposable = vscode.commands.registerCommand('extension.' + name, callback);
		context.subscriptions.push(disposable);
	}

	registerCommand(context, 'deleteLine', deleteLine);
	registerCommand(context, 'deleteEndOfLine', deleteEndOfLine);
	registerCommand(context, 'yank', yank);
}
