'use strict';

import * as vscode from 'vscode';

export let CommandActivator = (function(){

	function register(context: vscode.ExtensionContext, entries: ((editor: vscode.TextEditor) => void)[]) {
		entries.forEach(entry => {
			let disposable = vscode.commands.registerCommand('extension.' + entry.name, () => {
				let editor = vscode.window.activeTextEditor;
				if (!editor) {
					return;
				}
				entry(editor);
			});
			context.subscriptions.push(disposable);
		});
	}

	return {
		register: register
	};
})();
