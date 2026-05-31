'use strict';

import * as vscode from 'vscode';
import * as path from 'path';

type FileQuickPickItem = vscode.QuickPickItem & { uri: vscode.Uri };

export let FileCommand = (function() {

	async function openFile() {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders || workspaceFolders.length === 0) {
			vscode.window.showWarningMessage('No workspace folder is open.');
			return;
		}

		const qp = vscode.window.createQuickPick<FileQuickPickItem>();
		qp.placeholder = 'Type file name to open';
		qp.matchOnDescription = true;
		qp.show();

		const uris = await vscode.workspace.findFiles(
			'**/*',
			'{**/node_modules/**,**/.git/**,**/.hg/**,**/out/**}'
		);

		const allItems: FileQuickPickItem[] = uris.map(uri => {
			const rel = vscode.workspace.asRelativePath(uri, false);
			return {
				label: path.basename(uri.fsPath),
				description: path.dirname(rel),
				uri
			};
		});
		allItems.sort((a, b) => a.label.localeCompare(b.label));

		qp.onDidChangeValue(() => {
			if (qp.items.length === 0) {
				qp.items = allItems;
			}
		});

		qp.onDidAccept(async () => {
			const selected = qp.selectedItems[0];
			qp.hide();
			if (selected) {
				const doc = await vscode.workspace.openTextDocument(selected.uri);
				await vscode.window.showTextDocument(doc);
			}
		});

		qp.onDidHide(() => qp.dispose());
	}

	return {
		activate: (context: vscode.ExtensionContext) => {
			context.subscriptions.push(
				vscode.commands.registerCommand('extension.openFile', openFile)
			);
		}
	};
})();
