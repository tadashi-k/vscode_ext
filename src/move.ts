'use strict';

/**
 * Move cursor position command
 */

import * as vscode from 'vscode';
import { CommandActivator } from './command';

export let MoveCommand = (function(){

	const SPACE =  0;
	const UPPER_CASE = 1;
	const LOWER_CASE = 2;
	const NUMBER = 3;
	const UNDERSCORE = 4;
	const OTHER = 5;

	function charType(c:string) {
		if (/[ \t]/.test(c)) {
			return SPACE;
		} else if (/[A-Z]/.test(c)) {
			return UPPER_CASE;
		} else if (/[a-z]/.test(c)) {
			return LOWER_CASE;
		} else if (/[0-9]/.test(c)) {
			return NUMBER;
		} else if (/_/.test(c)) {
			return UNDERSCORE;
		} else {
			return OTHER;
		}
	}

	function nextRegexp(text : string, cursor:number, regexp: RegExp) {
		if (regexp) {
			let match = regexp.exec(text.slice(cursor));
			if (match) {
				return cursor + match[0].length;
			}
		}
		return cursor;
	}

	function prevRegexp(text : string, cursor:number, regexp: RegExp) {
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

		let regexp;
		switch (charType(text.charAt(cursor))) {
			case SPACE:
				break;
			case UPPER_CASE:
				regexp = /^[A-Z0-9]+[a-z0-9]*/;
				break;
			case LOWER_CASE:
				regexp = /^[a-z0-9]+/;
				break;
			case NUMBER:
				regexp = /^[A-Za-z0-9]+/;
				break;
			case UNDERSCORE:
				regexp = /^_[A-Za-z0-9]+/;
				break;
			case OTHER:
				regexp = /^[^A-Za-z0-9_ \t]+/;
				break;
		}
		if (regexp) {
			cursor = nextRegexp(text, cursor, regexp);
		}

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

		let regexp;
		switch (charType(text.charAt(cursor - 1))) {
			case SPACE:
				break;
			case UPPER_CASE:
				regexp = /[A-Z0-9]+[a-z0-9]*$/;
				break;
			case LOWER_CASE:
				regexp = /[A-Z0-9]*[a-z0-9]+$/;
				break;
			case NUMBER:
				regexp = /[A-Za-z0-9]+$/;
				break;
			case UNDERSCORE:
				regexp = /_[A-Za-z0-9]+$/;
				break;
			case OTHER:
				regexp = /[^A-Za-z0-9_ \t]+$/;
				break;
		}
		if (regexp) {
			cursor = prevRegexp(text, cursor, regexp);
		}

		pos = new vscode.Position(pos.line, cursor);
		editor.selection = new vscode.Selection(pos, pos);
	}

	return {
		activate: (context: vscode.ExtensionContext) => {
			CommandActivator.register(context, [nextWord, prevWord]);
		}
	};
})();