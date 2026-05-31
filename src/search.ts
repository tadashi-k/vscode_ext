'use strict';

import * as vscode from 'vscode';
import { CommandActivator } from './command';

const MAX_SEARCH_RESULTS = 500;

type WordQuickPickItem = vscode.QuickPickItem & { position: vscode.Position };

export let SearchCommand = (function() {

	function searchWord(editor: vscode.TextEditor) {
		const document = editor.document;
		const originalSelection = editor.selection;

		const qp = vscode.window.createQuickPick<WordQuickPickItem>();
		qp.placeholder = 'Type to search in current file';

		function buildItems(value: string): WordQuickPickItem[] {
			if (!value) {
				return [];
			}
			const items: WordQuickPickItem[] = [];
			const lowerValue = value.toLowerCase();

			for (let lineIdx = 0; lineIdx < document.lineCount && items.length < MAX_SEARCH_RESULTS; lineIdx++) {
				const lineText = document.lineAt(lineIdx).text;
				const lowerLine = lineText.toLowerCase();
				let searchFrom = 0;
				while (items.length < MAX_SEARCH_RESULTS) {
					const col = lowerLine.indexOf(lowerValue, searchFrom);
					if (col === -1) { break; }
					items.push({
						label: lineText.trim() || ' ',
						description: `Ln ${lineIdx + 1}, Col ${col + 1}`,
						position: new vscode.Position(lineIdx, col)
					});
					searchFrom = col + 1;
				}
			}
			return items;
		}

		qp.onDidChangeValue((value) => {
			qp.items = buildItems(value);
		});

		qp.onDidChangeActive((active) => {
			if (active[0]) {
				const pos = active[0].position;
				editor.selection = new vscode.Selection(pos, pos);
				editor.revealRange(editor.selection, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
			}
		});

		let m_accepted = false;
		qp.onDidAccept(() => {
			const selected = qp.selectedItems[0];
			m_accepted = true;
			qp.hide();
			if (selected) {
				const pos = selected.position;
				editor.selection = new vscode.Selection(pos, pos);
				editor.revealRange(editor.selection, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
			}
		});

		qp.onDidHide(() => {
			if (!m_accepted) {
				editor.selection = originalSelection;
				editor.revealRange(originalSelection, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
			}
			qp.dispose();
		});

		qp.show();
	}

	return {
		activate: (context: vscode.ExtensionContext) => {
			CommandActivator.register(context, [searchWord]);
		}
	};
})();
