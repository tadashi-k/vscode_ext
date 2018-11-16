'use strict';

/**
 * Edit Command
 */

import * as vscode from 'vscode';
import { copy } from 'copy-paste';
import { CommandActivator } from './command';
import { MoveCommand } from './move';

export let EditCommand = (function(){
	var yankString: string;
	var yankLine: number = -1;
	var yankStartOfLine: boolean = false;

	function deleteLine(editor : vscode.TextEditor) {
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

	function deleteEndOfLine(editor : vscode.TextEditor) {
		let document = editor.document;
		let pos = editor.selection.active;
		let lineEnd = document.lineAt(pos).range.end;
		let range = new vscode.Range(pos, lineEnd);

		yankString = document.getText(range);
		yankStartOfLine = false;
		yankLine = -1;

		editor.edit((edit: vscode.TextEditorEdit) => {
			edit.delete(range);
		});
	}

	function deleteWord(editor : vscode.TextEditor) {
		let document = editor.document;
		let pos = editor.selection.active;
		MoveCommand.nextWord(editor);
		let next = editor.selection.active;
		let range = new vscode.Range(pos, next);

		if (yankLine !== pos.line) {
			yankString = '';
			yankLine = pos.line;
		}
		yankString += document.getText(range);
		yankStartOfLine = false;

		editor.edit((edit: vscode.TextEditorEdit) => {
			edit.delete(range);
		});
	}

	function yank(editor : vscode.TextEditor) {
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

	function copyAndUnselect(editor : vscode.TextEditor) {
		let selection = editor.selection;
		let document = editor.document;
		let str = document.getText(selection);
		// console.log(str);

		copy(str);
		let pos = editor.selection.active;
		editor.selection = new vscode.Selection(pos, pos);
	}

	return {
		activate: (context: vscode.ExtensionContext) => {
			CommandActivator.register(context, [deleteLine, deleteEndOfLine, deleteWord, yank, copyAndUnselect]);
		}
	};
})();

