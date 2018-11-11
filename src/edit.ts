'use strict';

import * as vscode from 'vscode';
import { copy } from 'copy-paste';
import { CommandActivator } from './command';

export let EditCommand = (function(){
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
		let editor = vscode.window.activeTextEditor;
		if (!editor) {
			return;
		}

		let selection = editor.selection;
		let document = editor.document;
		var yankPos: vscode.Position;
		yankLine = -1;

		if (yankStartOfLine) {
			yankPos = document.lineAt(selection.active).range.start;
		} else {
			yankPos = selection.active;
		}

		editor.edit((edit: vscode.TextEditorEdit) => {
			edit.insert(yankPos, yankString);
		});
	}

	function copyAndUnselect() {
		let editor = vscode.window.activeTextEditor;
		if (!editor) {
			return;
		}
		let selection = editor.selection;
		let document = editor.document;
		let str = document.getText(selection);
		// console.log(str);

		copy(str);
		let pos = editor.selection.active;
		editor.selection = new vscode.Selection(pos, pos);
	}

	function activate(context: vscode.ExtensionContext) {
		CommandActivator.register(context, [deleteLine, deleteEndOfLine, yank, copyAndUnselect]);
	}

	return {
		activate: activate
	};
})();
