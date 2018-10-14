'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
    var yankLine :string;

    // The command has been defined in the package.json file
    // Now provide the implementation of the command with  registerCommand
    // The commandId parameter must match the command field in package.json
    let disposableDeleteLine = vscode.commands.registerCommand('extension.deleteLine', () => {
        // The code you place here will be executed every time your command is executed
        let editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        let selection = editor.selection;
        let document = editor.document;
        let linePos = document.lineAt(selection.active).range.start;
        let range = new vscode.Range(linePos, linePos.translate(1));

        yankLine = editor.document.getText(range);

        editor.edit((edit: vscode.TextEditorEdit) => {
            edit.delete(range);
        });
    });

    context.subscriptions.push(disposableDeleteLine);

    let disposableYank = vscode.commands.registerCommand('extension.yank', () => {
        // The code you place here will be executed every time your command is executed
        let editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        let selection = editor.selection;
        let document = editor.document;
        let linePos = document.lineAt(selection.active).range.start;

        editor.edit((edit: vscode.TextEditorEdit) => {
            edit.insert(linePos, yankLine);
        });
    });

    context.subscriptions.push(disposableYank);
}

// this method is called when your extension is deactivated
export function deactivate() {
}