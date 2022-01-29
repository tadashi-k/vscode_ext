'use strict';

/**
 * Edit Command
 */

import * as vscode from 'vscode';
import { CommandActivator } from './command';
import { MoveCommand } from './move';
import { MacroCommand } from './macro';

export let EditCommand = (function(){
	var yankString: string;
	var yankLine: number = -1;
	var yankStartOfLine: boolean = false; // do yank by line if true
	var completeWords : string[] = [];
	var completePos : vscode.Position | null = null;
	var completeIndex : number = -1;

	function deleteLine(editor: vscode.TextEditor) {
		let document = editor.document;
		let linePos = document.lineAt(editor.selection.active).range.start;
		let range = new vscode.Range(linePos, linePos.translate(1));

		let line = document.getText(range);

		if (linePos.line === yankLine && yankStartOfLine === true) {
			yankString += line;
		} else {
			yankString = line;
			yankStartOfLine = true;
		}
		yankLine = linePos.line;

		editor.edit((edit) => {
			edit.delete(range);
		});
		MacroCommand.push(deleteLine);
	}

	function deleteEndOfLine(editor : vscode.TextEditor) {
		let document = editor.document;
		let pos = editor.selection.active;
		let lineEnd = document.lineAt(pos).range.end;
		let range = new vscode.Range(pos, lineEnd);

		yankString = document.getText(range);
		yankStartOfLine = false;
		yankLine = -1;

		editor.edit((edit) => {
			edit.delete(range);
		});
		MacroCommand.push(deleteEndOfLine);
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

		editor.edit((edit) => {
			edit.delete(range);
		});
		MacroCommand.push(deleteWord);
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

		editor.edit((edit) => {
			edit.insert(yankPos, yankString);
		});
		MacroCommand.push(yank);
	}

	function copyToClipboard(editor: vscode.TextEditor) {
		let str = editor.document.getText(editor.selection);
		return vscode.env.clipboard.writeText(str);
	}

	function copyAndUnselect(editor: vscode.TextEditor) {
		copyToClipboard(editor).then(() => {
			let pos = editor.selection.active;
			editor.selection = new vscode.Selection(pos, pos);
		});
		MacroCommand.push(copyAndUnselect);
	}

	function cut(editor: vscode.TextEditor) {
		copyToClipboard(editor).then(() => {
			editor.edit((edit) => {
				edit.delete(editor.selection);
			});
		});

		MacroCommand.push(cut);
	}

	function paste(editor: vscode.TextEditor) {
		vscode.env.clipboard.readText().then((value) => {
			editor.edit((edit) => {
				edit.replace(editor.selection, value);
			});
		});
		MacroCommand.push(paste);
	}

	function wordComplete(editor: vscode.TextEditor) {
		const SEARCH_RANGE = 1000;

		let document = editor.document;
		let pos = editor.selection.active;
		let lineText = document.lineAt(pos).text;
		let match = /[a-zA-Z0-9_]+$/.exec(lineText.slice(0, pos.character));
		if (!match) {
			completeIndex = -1;
			return;
		}
		let refWord = match[0];
		let startPos = new vscode.Position(pos.line, pos.character - refWord.length);

		if (isRebuild()) {
			buildList(refWord);
		} else {
			completeIndex++;
		}
		if (completeIndex >= completeWords.length) {
			completeIndex = 0;
		}

		if (completeWords.length > 0) {
			let endPos: vscode.Position;
			let endMatch = /^[a-zA-Z0-9_]+/.exec(lineText.slice(pos.character));
			if (endMatch) {
				endPos = new vscode.Position(pos.line, pos.character + endMatch[0].length);
			} else {
				endPos = pos;
			}
			completePos = startPos;
			editor.edit((edit: vscode.TextEditorEdit) => {
				edit.delete(new vscode.Range(startPos, endPos));
				edit.insert(startPos, completeWords[completeIndex]);
			});
		} else {
			completeIndex = 0;
		}

		function isRebuild(): boolean {
			if (completeIndex < 0) {
				return true;
			}
			if (completePos === null || completePos.isEqual(startPos) === false) {
				return true;
			}
			if (completeWords.length === 0 || completeWords[completeIndex] !== refWord) {
				return true;
			}
			return false;
		}

		function buildList(ref: string) {
			let regexp = new RegExp('[^a-zA-Z0-9_]' + ref + '[a-zA-Z0-9_]+', 'gi');
			completeWords.length = 0;
			completeIndex = 0;

			// search current line
			appendWord(document.lineAt(pos.line).text);

			// spread search area from current line
			for (let i = 1; i < SEARCH_RANGE; i++) {
				let ref: number;
				ref = pos.line - i;
				let valid = false;
				if (ref >= 0) {
					appendWord(document.lineAt(ref).text);
					valid = true;
				}
				ref = pos.line + i;
				if (ref < document.lineCount) {
					appendWord(document.lineAt(ref).text);
					valid = true;
				}
				if (valid === false) {
					break;
				}
			}

			function appendWord(text: string): void {
				let match;
				do {
					match = regexp.exec(text);
					if (match) {
						let word = match[0].slice(1); // delete first not word character
						let found = completeWords.find((string) => {
							return string === word;
						});
						if (found === undefined) {
							completeWords.push(word);
						}
					}
				} while (match);
			}
		}
	}

	return {
		activate: (context: vscode.ExtensionContext) => {
			CommandActivator.register(context, [deleteLine, deleteEndOfLine, deleteWord, yank, copyAndUnselect, cut, paste, wordComplete]);
		}
	};
})();

