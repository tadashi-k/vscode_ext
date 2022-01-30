'use strict';

import * as vscode from 'vscode';

export let CommandActivator = (function(){

	function registerAsync(context: vscode.ExtensionContext, entries: ((editor: vscode.TextEditor) => Thenable<any>)[]) {
		entries.forEach(entry => {
			let disposable = vscode.commands.registerCommand('extension.' + entry.name, () => {
				let editor = vscode.window.activeTextEditor;
				if (!editor) {
					return new Promise<void>((resolve, reject) => {
						reject('extension.' + entry.name + 'cannot execute without editor');
					});
				} else {
					return entry(editor);
				}
			});
			context.subscriptions.push(disposable);
		});
	}

	function register(context: vscode.ExtensionContext, entries: ((editor: vscode.TextEditor) => void)[]) {
		entries.forEach(entry => {
			let disposable = vscode.commands.registerCommand('extension.' + entry.name, () => {
				return new Promise<void>((resolve, reject) => {
					let editor = vscode.window.activeTextEditor;
					if (!editor) {
						reject('extension.' + entry.name + 'cannot execute without editor');
					} else {
						entry(editor);
						resolve();
					}
				});
			});
			context.subscriptions.push(disposable);
		});
	}

	return {
		register: register,
		registerAsync: registerAsync
	};
})();
