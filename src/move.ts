'use strict';

/**
 * Move cursor position command
 */

import * as vscode from 'vscode';
import { CommandActivator } from './command';

class Mark {
	public constructor(document: vscode.TextDocument, offset: number, content: string) {
		this.document = document;
		this.offset = offset;
		this.content = content;
	}
	public document: vscode.TextDocument;
	public offset: number;
	public content: string;
};

export let MoveCommand = (function(){
	const MAX_MARK = 20;
	let markList: Mark[] = [];

	function charType(c:string) : string {
		if (/[ \t]/.test(c)) {
			return ' ';
		} else if (/[A-Z]/.test(c)) {
			return 'A';
		} else if (/[a-z]/.test(c)) {
			return 'a';
		} else if (/_/.test(c)) {
			return '_';
		} else if (/[0-9]/.test(c)) {
			return '[0-9]+';
		} else if (/[\u3040-\u309f]/.test(c)) {
			return '[\u3040-\u309f]+';
		} else if (/[\u30a0-\u30ff]/.test(c)) {
			return '[\u30a0-\u30ff]+';
		} else if (/[\u3100-\u33ff]/.test(c)) {
			return '[\u3100-\u33ff]+';
		} else if (/[\u3400-\u9fff]/.test(c)) {
			return '[\u3400-\u9fff]+';
		} else {
			return '[^A-Za-z0-9_ \t\u3040-\u9fff]+';
		}
	}

	function nextRegexp(text: string, cursor: number, regexp: RegExp | null) {
		if (regexp) {
			let match = regexp.exec(text.slice(cursor));
			if (match) {
				return cursor + match[0].length;
			}
		}
		return cursor;
	}

	function prevRegexp(text: string, cursor: number, regexp: RegExp | null) {
		if (regexp) {
			let match = regexp.exec(text.slice(0, cursor));
			if (match) {
				return cursor - match[0].length;
			}
		}
		return cursor;
	}

	function nextWord(editor: vscode.TextEditor) {
		let document = editor.document;
		let pos = editor.selection.active;
		let text = document.lineAt(pos).text;

		let cursor = pos.character;
		if (cursor === text.length) {
			pos = new vscode.Position(pos.line + 1, 0);
			editor.selection = new vscode.Selection(pos, pos);
			return;
		}

		let regexp = null;
		let type = charType(text.charAt(cursor));
		switch (type) {
			case ' ':
				break;
			case 'A':
				regexp = /^[A-Z]+[a-z]*/;
				break;
			case 'a':
				regexp = /^[a-z]+/;
				break;
			case '_':
				regexp = /^_[A-Za-z0-9]+/;
				break;
			default:
				regexp = new RegExp('^' + type);
				break;
		}
		cursor = nextRegexp(text, cursor, regexp);
		cursor = nextRegexp(text, cursor, /^[_ \t]+/);

		pos = new vscode.Position(pos.line, cursor);
		editor.selection = new vscode.Selection(pos, pos);
	}

	function prevWord(editor: vscode.TextEditor) {
		let document = editor.document;
		let pos = editor.selection.active;

		let cursor = pos.character;
		if (cursor === 0) {
			cursor = document.lineAt(pos.line - 1).text.length;
			pos = new vscode.Position(pos.line - 1, cursor);
			editor.selection = new vscode.Selection(pos, pos);
			return;
		}

		let text = document.lineAt(pos).text;
		cursor = prevRegexp(text, cursor, /[_ \t]+$/);

		let regexp = null;
		let type = charType(text.charAt(cursor - 1));
		switch (type) {
			case ' ':
				break;
			case 'A':
				regexp = /[A-Z]+[a-z]*$/;
				break;
			case 'a':
				regexp = /[A-Z]*[a-z]+$/;
				break;
			case '_':
				regexp = /_[A-Za-z0-9]+$/;
				break;
			default:
				regexp = new RegExp(type + '$');
				break;
		}
		cursor = prevRegexp(text, cursor, regexp);
		pos = new vscode.Position(pos.line, cursor);
		editor.selection = new vscode.Selection(pos, pos);
	}

	function mark(editor: vscode.TextEditor) {
		let document = editor.document;
		let pos = editor.selection.active;
		let offset = document.offsetAt(pos);

		let lineEnd = document.lineAt(pos).range.end;
		let range = new vscode.Range(pos, lineEnd);
		let content = document.getText(range);
		markList.unshift(new Mark(document, offset, content));

		while (markList.length > MAX_MARK) {
			markList.pop();
		}
	}

	function openDocumentByMark(editor: vscode.TextEditor, mark: Mark) {
		if (editor.document.fileName != mark.document.fileName) {
			vscode.workspace.openTextDocument(mark.document.fileName).then(
				(document) => vscode.window.showTextDocument(document).then(
					(editor) => moveTo(editor)
				)
			);
		} else {
			moveTo(editor);
		}

		function moveTo(editor: vscode.TextEditor) {
			let pos = editor.document.positionAt(mark.offset);
			editor.selection = new vscode.Selection(pos, pos);
			const revealType = vscode.TextEditorRevealType.InCenterIfOutsideViewport;
			editor.revealRange(editor.selection, revealType);
		}
	}

	function swapMark(editor: vscode.TextEditor) {
		if (markList[0]) {
			let recent = markList[0];
			markList.shift();
			mark(editor);
			openDocumentByMark(editor, recent);
		}
	}

	vscode.workspace.onDidChangeTextDocument((event) => {
		// console.log('change', event.document.fileName);
		event.contentChanges.forEach((change) => {
			console.log(change.rangeOffset, change.rangeLength, change.text.length);
			markList.forEach((mark) => {
				if (mark.document.fileName == event.document.fileName) {
					if (mark.offset > change.rangeOffset) {
						if (mark.offset < change.rangeOffset + change.rangeLength) {
							mark.offset = change.rangeOffset;
						} else {
							mark.offset = mark.offset - change.rangeLength + change.text.length;
						}
					}
				}
			});
		});
	});

	vscode.workspace.onDidCloseTextDocument((event) => {
		//console.log('close', event.fileName);
		let idx = 0;
		while (idx < markList.length) {
			if (markList[idx].document.fileName == event.fileName) {
				markList.splice(idx, 1);
			} else {
				idx++;
			}
		}
	});

	function gotoMark(editor: vscode.TextEditor) {
		if (markList.length == 0) {
			return;
		}

		let items: string[] = [];
		for (let i = 0; i < markList.length; i++) {
			let mark = markList[i];
			let pos = mark.document.positionAt(mark.offset);
			let filepath = mark.document.fileName.split(/[/\\]/);
			let filename = (filepath.length > 0) ? filepath[filepath.length - 1] : '';
			let str = (i + 1) + ': ' + filename + ', Ln ' + (pos.line + 1) + ', Col ' + (pos.character + 1) + ', ' + mark.content;
			items.push(str);
		}
		vscode.window.showQuickPick(items).then(
			(selection) => {
				if (selection) {
					let match = /^[0-9]+:/.exec(selection);
					if (match) {
						let idx = parseInt(match[0]) - 1;
						if (0 <= idx && idx < markList.length) {
							openDocumentByMark(editor, markList[idx]);
						}
					}
				}
			}
		)
	}

	return {
		activate: (context: vscode.ExtensionContext) => {
			CommandActivator.register(context, [nextWord, prevWord, mark, swapMark, gotoMark]);
		},
		nextWord : nextWord
	};
})();
