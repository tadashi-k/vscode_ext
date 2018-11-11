'use strict';

/**
 * Move cursor position command
 */

import * as vscode from 'vscode';
import { CommandActivator } from './command';

export let MoveCommand = (function(){

	const isWord = /^[a-zA-Z_]+/;
	const isOther = /^[^a-zA-Z_ \t]+/;
	const isSpace = /^[ \t]+/;
	
	function nextWord(editor: vscode.TextEditor) {
		let document = editor.document;
		let pos = editor.selection.active;
		let text = document.lineAt(pos).text;

		let cursor = pos.character;
		let c = text.charAt(cursor);
		if (isWord.test(c)) {
			let match = isWord.exec(text.slice(cursor));
			if (match) {
				cursor += match[0].length;
			}
		} else if (!isSpace.test(c)) {
			let match = isOther.exec(text.slice(cursor));
			if (match) {
				cursor += match[0].length;
			}
		}

		let match = isSpace.exec(text.slice(cursor));
		if (match) {
			cursor += match[0].length;
		}

		pos = new vscode.Position(pos.line, cursor);
		editor.selection = new vscode.Selection(pos, pos);
	}

	return {
		activate: (context: vscode.ExtensionContext) => {
			CommandActivator.register(context, [nextWord]);
		}
	};
})();