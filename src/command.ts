'use strict';

import * as vscode from 'vscode';

export let CommandActivator = (function(){

	function register(context: vscode.ExtensionContext, entries: (() => void)[]) {
		entries.forEach(entry => {
			let disposable = vscode.commands.registerCommand('extension.' + entry.name, entry);
			context.subscriptions.push(disposable);
		});
	}

	return {
		register: register
	};
})();
