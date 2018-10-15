'use strict';

import * as vscode from 'vscode';

export function activateEditorExt(context: vscode.ExtensionContext) {
	var yankLine: string;

	function deleteLine() {
		let editor = vscode.window.activeTextEditor;
		if (!editor) {
			return;
		}

		let selection = editor.selection;
		let document = editor.document;
		let linePos = document.lineAt(selection.active).range.start;
		let range = new vscode.Range(linePos, linePos.translate(1));

		let line = editor.document.getText(range);
		console.log(line);
		yankLine = line;

		editor.edit((edit: vscode.TextEditorEdit) => {
			console.log('edit');
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
		let linePos = document.lineAt(selection.active).range.start;

		editor.edit((edit: vscode.TextEditorEdit) => {
			edit.insert(linePos, yankLine);
		});
	}

	function registerCommand(context: vscode.ExtensionContext, name: string, callback: () => void) {
		let disposable = vscode.commands.registerCommand('extension.' + name, callback);
		context.subscriptions.push(disposable);
	}

	registerCommand(context, 'deleteLine', deleteLine);
	registerCommand(context, 'yank', yank);
}
