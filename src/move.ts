'use strict';

/**
 * Move cursor position command
 */

import * as vscode from 'vscode';
import { CommandActivator } from './command';

export let MoveCommand = (function(){
	let markMap = new Map<string, vscode.Position[]>();
	const MAX_MARK = 10;

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
		let key = editor.document.fileName;
		let pos = editor.selection.active;
		let list = markMap.get(key);
		if (list) {
			list.push(pos);
			while (list.length > MAX_MARK) {
				list.shift();
			}
		} else {
			markMap.set(key, [pos]);
		}
	}

	function swapMark(editor: vscode.TextEditor) {
		let key = editor.document.fileName;
		let current = editor.selection.active;
		let list = markMap.get(key);
		if (list && list[0]) {
			let idx = list.length - 1;
			let mark = list[idx];
			list[idx] = current;
			editor.selection = new vscode.Selection(mark, mark);
			const revealType = vscode.TextEditorRevealType.InCenterIfOutsideViewport;
			editor.revealRange(editor.selection, revealType);
		}
	}

	function gotoMark(editor: vscode.TextEditor) {
		let document = editor.document;
		let key = document.fileName;
		let list = markMap.get(key);
		if (!list) {
			return;
		}
		let items: string[] = [];
		for (let i = 0; i < list.length; i++) {
			let idx = list.length - 1 - i;
			let pos = list[idx];
			let lineEnd = document.lineAt(pos).range.end;
			let range = new vscode.Range(pos, lineEnd);
			let content = document.getText(range);
			let str = (i + 1) + ', line: ' + pos.line + ', Character: ' + pos.character + ', ' + content;
			items.push(str);
		}
		vscode.window.showQuickPick(items).then(
			(selection) => {
				if (selection) {
					let match = /^[0-9]+,/.exec(selection);
					if (match && list) {
						let idx = list.length - parseInt(match[0]);
						if (0 <= idx && idx < list.length) {
							let mark = list[idx]
							editor.selection = new vscode.Selection(mark, mark);
							const revealType = vscode.TextEditorRevealType.InCenterIfOutsideViewport;
							editor.revealRange(editor.selection, revealType);
						}
					}
				}
			},
			(reason) => { }
		);
	}

	return {
		activate: (context: vscode.ExtensionContext) => {
			CommandActivator.register(context, [nextWord, prevWord, mark, swapMark, gotoMark]);
		},
		nextWord : nextWord
	};
})();
