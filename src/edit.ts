'use strict';

/**
 * Edit Command
 */

import * as vscode from 'vscode';
import { CommandActivator, EDIT_REJECTED_ERROR } from './command';
import { MoveCommand } from './move';
import { MacroCommand } from './macro';

export let EditCommand = (function(){
	let yankString: string;
	let yankLine: number = -1;
	let yankStartOfLine: boolean = false; // do yank by line if true
	let completeWords : string[] = [];
	let completePos : vscode.Position | null = null;
	let completeIndex : number = -1;
	let undoStatus = 0;

	function getEditOptions() {
		if (undoStatus == 0) {
			return {undoStopBefore: true, undoStopAfter: true};
		} else if (undoStatus == 1) {
			undoStatus = 2;
			return {undoStopBefore: true, undoStopAfter: false};
		} else {
			return {undoStopBefore: false, undoStopAfter: false};
		}
	}

	function deleteLine(editor: vscode.TextEditor) {
		return new Promise<void>((resolve, reject) => {
			let document = editor.document;
			let linePos = document.lineAt(editor.selection.active).range.start;
			let range = new vscode.Range(linePos, linePos.translate(1));
			let line = document.getText(range);

			let newYankString: string;
			if (linePos.line === yankLine && yankStartOfLine === true) {
				newYankString = yankString + line;
			} else {
				newYankString = line;
			}

			MacroCommand.lock();
			editor.edit((edit) => {
					edit.delete(range);
				}, getEditOptions()).then((success) => {
					if (success) {
						yankString = newYankString;
						yankStartOfLine = true;
						yankLine = linePos.line;
						MacroCommand.push(deleteLine);
					resolve();
				} else {
					reject(EDIT_REJECTED_ERROR);
				}
			});
		});
	}

	function deleteEndOfLine(editor : vscode.TextEditor) {
		return new Promise<void>((resolve, reject) => {
			let document = editor.document;
			let pos = editor.selection.active;
			let lineEnd = document.lineAt(pos).range.end;
			let range = new vscode.Range(pos, lineEnd);
			let text = document.getText(range);

			MacroCommand.lock();
			editor.edit((edit) => {
					edit.delete(range);
				}, getEditOptions()).then((success) => {
					if (success) {
						yankString = text;
						yankStartOfLine = false;
						yankLine = -1;
						MacroCommand.push(deleteEndOfLine);
					resolve();
				} else {
					reject(EDIT_REJECTED_ERROR);
				}
			});
		});
	}

	function deleteWord(editor : vscode.TextEditor) {
		return new Promise<void>((resolve, reject) => {
			let document = editor.document;
			let pos = editor.selection.active;
			MoveCommand.nextWord(editor);
			let next = editor.selection.active;
			let range = new vscode.Range(pos, next);
			let text = document.getText(range);

			let newYankString: string;
			if (yankLine !== pos.line) {
				newYankString = text;
			} else {
				newYankString = yankString + text;
			}

			MacroCommand.lock();
			editor.edit((edit) => {
					edit.delete(range);
				}, getEditOptions()).then((success) => {
					if (success) {
						yankString = newYankString;
						yankStartOfLine = false;
						yankLine = pos.line;
						MacroCommand.push(deleteWord);
					resolve();
				} else {
					// Restore cursor to original position so retry starts correctly
					editor.selection = new vscode.Selection(pos, pos);
					reject(EDIT_REJECTED_ERROR);
				}
			});
		});
	}

	function yank(editor : vscode.TextEditor) {
		return new Promise<void>((resolve, reject) => {
			let selection = editor.selection;
			let document = editor.document;
			var yankPos: vscode.Position;

			if (yankStartOfLine) {
				yankPos = document.lineAt(selection.active).range.start;
			} else {
				yankPos = selection.active;
			}

			MacroCommand.lock();
			editor.edit((edit) => {
					edit.insert(yankPos, yankString);
				}, getEditOptions()).then((success) => {
					if (success) {
						yankLine = -1;
						MacroCommand.push(yank);
					resolve();
				} else {
					reject(EDIT_REJECTED_ERROR);
				}
			});
		});
	}

	function copyToClipboard(editor: vscode.TextEditor) {
		let str = editor.document.getText(editor.selection);
		return vscode.env.clipboard.writeText(str);
	}

	function copyAndUnselect(editor: vscode.TextEditor) {
		return new Promise<void>((resolve, reject) => {
			copyToClipboard(editor).then(() => {
				MacroCommand.lock();
				let pos = editor.selection.active;
				editor.selection = new vscode.Selection(pos, pos);
				MacroCommand.push(copyAndUnselect);
				resolve();
			});
		});
	}

	function cut(editor: vscode.TextEditor) {
		return new Promise<void>((resolve, reject) => {
			copyToClipboard(editor).then(() => {
				MacroCommand.lock();
				editor.edit((edit) => {
						edit.delete(editor.selection);
					}, getEditOptions()).then((success) => {
						if (success) {
							MacroCommand.push(cut);
						resolve();
					} else {
						reject(EDIT_REJECTED_ERROR);
					}
				});
			});
		});
	}

	function paste(editor: vscode.TextEditor) {
		return new Promise<void>((resolve, reject) => {
			vscode.env.clipboard.readText().then((value) => {
				MacroCommand.lock();
				editor.edit((edit) => {
					edit.delete(editor.selection);
					edit.insert(editor.selection.active, value);
				}, getEditOptions()).then((success) => {
					if (success) {
						MacroCommand.push(paste);
						resolve();
					} else {
						reject(EDIT_REJECTED_ERROR);
					}
				});
			});
		});
	}

	function wordComplete(editor: vscode.TextEditor) {
		const SEARCH_RANGE = 1000;
		let document = editor.document;

		return new Promise<void>((resolve, reject) => {
			let pos = editor.selection.active;
			let lineText = document.lineAt(pos).text;
			let match = /[a-zA-Z0-9_]+$/.exec(lineText.slice(0, pos.character));
			if (!match) {
				completeIndex = -1;
				resolve(); // finish normally
				return;
			}
			let refWord = match[0];
			let startPos = new vscode.Position(pos.line, pos.character - refWord.length);

			if (isRebuild(refWord, startPos)) {
				buildList(pos, refWord);
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
					}).then((success) => {
						if (success) {
							resolve();
						} else {
							reject(EDIT_REJECTED_ERROR);
						}
					});
			} else {
				completeIndex = 0;
				resolve();
			}
		});

		function isRebuild(refWord: string, startPos: vscode.Position): boolean {
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

		function buildList(pos: vscode.Position, ref: string) {
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
			CommandActivator.registerAsync(context, [deleteLine, deleteEndOfLine, deleteWord, yank, copyAndUnselect, cut, paste, wordComplete]);
		},
		startUndoFusion: () => {
			undoStatus = 1;
		},
		stopUndoFution: () => {
			undoStatus = 0;
		},
		edit : (editor: vscode.TextEditor, callback :(edit: vscode.TextEditorEdit) => void) => {
			return editor.edit(callback, getEditOptions());
		}
	};
})();

