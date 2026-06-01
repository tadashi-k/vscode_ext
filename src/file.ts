'use strict';

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

type FileQuickPickItem = vscode.QuickPickItem & { uri: vscode.Uri };

export let FileCommand = (function() {

	function readIgnorePatterns(workspaceFolder: string, ignoreFilename: string): string[] {
		const ignoreFilePath = path.join(workspaceFolder, ignoreFilename);
		const patterns: string[] = [];
		
		if (!fs.existsSync(ignoreFilePath)) {
			return patterns;
		}
		
		try {
			const content = fs.readFileSync(ignoreFilePath, 'utf8');
			let isRegexpMode = false;
			
			for (const line of content.split('\n')) {
				const trimmed = line.trim();
				
				if (ignoreFilename === '.hgignore' && trimmed.startsWith('syntax:')) {
					isRegexpMode = trimmed.includes('regexp');
					continue;
				}
				
				if (!trimmed || trimmed.startsWith('#')) {
					continue;
				}
				
				if (ignoreFilename === '.hgignore' && isRegexpMode) {
					patterns.push(trimmed);
				} else {
					patterns.push(trimmed);
				}
			}
		} catch (err) {
			console.error(`Failed to read ${ignoreFilename}:`, err);
		}
		
		return patterns;
	}

	function patternsToGlobExclude(patterns: string[]): string {
		const globs: string[] = [];
		
		for (const pattern of patterns) {
			if (!pattern) {
				continue;
			}
			
			let glob = pattern;
			if (glob.endsWith('/')) {
				glob = `**/${glob}**`;
			} else if (!glob.includes('/')) {
				glob = `**/${glob}`;
				if (!glob.includes('*')) {
					glob = `${glob}/**`;
				}
			} else {
				if (!glob.startsWith('**/')) {
					glob = `**/${glob}`;
				}
				if (!glob.endsWith('/**') && !glob.includes('*')) {
					glob = `${glob}/**`;
				}
			}
			globs.push(glob);
		}
		
		return globs.length > 0 ? `{${globs.join(',')}}` : '';
	}

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

		const workspaceFolderPath = workspaceFolders[0].uri.fsPath;
		
		const gitignorePatterns = readIgnorePatterns(workspaceFolderPath, '.gitignore');
		const hgignorePatterns = readIgnorePatterns(workspaceFolderPath, '.hgignore');
		const allPatterns = [...gitignorePatterns, ...hgignorePatterns];
		
		const gitignoreExclude = patternsToGlobExclude(allPatterns);
		const excludePattern = gitignoreExclude 
			? `{**/node_modules/**,**/.git/**,**/.hg/**,**/out/**,${gitignoreExclude.slice(1, -1)}}`
			: '{**/node_modules/**,**/.git/**,**/.hg/**,**/out/**}';

		const uris = await vscode.workspace.findFiles(
			'**/*',
			excludePattern
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
