'use strict';

import * as vscode from 'vscode';

export const EDIT_REJECTED_ERROR = 'EditRejected';
const MAX_EDIT_RETRIES = 5;
const EDIT_RETRY_DELAY_MS = 50;

export let CommandActivator = (function () {
	let asyncSet = new Set<string>();

	function registerAsync(context: vscode.ExtensionContext, entries: ((editor: vscode.TextEditor) => Thenable<any>)[]) {
		entries.forEach(entry => {
			let disposable = vscode.commands.registerCommand('extension.' + entry.name, async () => {
				for (let attempt = 0; attempt <= MAX_EDIT_RETRIES; attempt++) {
					const editor = vscode.window.activeTextEditor;
					if (!editor) {
						return;
					}
					try {
						await entry(editor);
						return;
					} catch (err) {
						if (err === EDIT_REJECTED_ERROR && attempt < MAX_EDIT_RETRIES) {
							await new Promise<void>(resolve => setTimeout(resolve, EDIT_RETRY_DELAY_MS));
							continue;
						}
						if (err !== EDIT_REJECTED_ERROR) {
							throw err;
						}
					}
				}
			});
			context.subscriptions.push(disposable);
			asyncSet.add(entry.name);
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

	function isAsync(funcName: string) {
		return asyncSet.has(funcName);
	}

	return {
		register: register,
		registerAsync: registerAsync,
		isAsync: isAsync
	};
})();
