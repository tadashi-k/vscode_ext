'use strict';

import * as vscode from 'vscode';
import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';
import { CommandActivator } from './command';

const CONTEXT_LINES_BEFORE = 20;
const CONTEXT_LINES_AFTER = 0;

export let SuggestCommand = (function() {

	async function suggest(editor: vscode.TextEditor): Promise<void> {
		const config = vscode.workspace.getConfiguration('editext.llm');
		const baseUrl = config.get<string>('baseUrl') || 'http://localhost:1234/v1';
		const apiKey = config.get<string>('apiKey') || ''
		const model = config.get<string>('model') || 'qwen2.5-coder-3b-instruct';
		const maxRetries = config.get<number>('maxRetries') || 3;

		const document = editor.document;
		const position = editor.selection.active;
		const currentLine = position.line;
		const lineText = document.lineAt(currentLine).text;
		const beforeCursor = lineText.substring(0, position.character);
		const afterCursor = lineText.substring(position.character);

		const startLine = Math.max(0, currentLine - CONTEXT_LINES_BEFORE);
		const endLine = Math.min(document.lineCount - 1, currentLine + CONTEXT_LINES_AFTER);

		const contextLines: string[] = [];
		for (let i = startLine; i <= endLine; i++) {
			if (i === currentLine) {
				contextLines.push(`${beforeCursor}<CURSOR>${afterCursor}`);
			} else {
				contextLines.push(document.lineAt(i).text);
			}
		}
		const context = contextLines.join('\n');

		const language = document.languageId;
		const fileName = document.fileName.split(/[\\/]/).pop() || 'untitled';

		const systemPrompt = 'You are an inline code completion engine, like the autocomplete feature of an IDE. '
			+ 'You predict the exact text the developer is most likely to type at the cursor. '
			+ 'You output raw code only: no explanations, no markdown, no code fences.';

		const userPrompt = `Complete the ${language} code at the cursor position.\n\n`
			+ 'Rules:\n'
			+ '- The code below contains a <CURSOR> marker showing where the developer is typing.\n'
			+ '- Output ONLY the text that should be inserted at <CURSOR> to complete that line.\n'
			+ '- Do NOT repeat any text that appears before <CURSOR>; continue directly from where it ends.\n'
//			+ '- Do NOT include or continue the text after <CURSOR>; it stays as-is.\n'
//			+ '- Output at most one line of code. No explanation, no markdown fences, no comments about the suggestion.\n'
//			+ '- If nothing sensible can be added, output an empty string.\n'
			+ `\nFile: ${fileName}\nLanguage: ${language}\n\n`
			+ `\`\`\`${language}\n${context}\n\`\`\`\n\n`
			+ 'Text to insert at <CURSOR>:`';

		const apiBase = baseUrl.replace(/\/v1\/?$/, '').replace(/\/$/, '');
		const chatUrl = `${apiBase}/v1/chat/completions`;

		const requestBody: any = {
			model: model,
			messages: [
				{ role: 'system', content: systemPrompt },
				{ role: 'user', content: userPrompt }
			],
			max_tokens: 1000,
			temperature: 0.0
		};

		requestBody.reasoning_effort = 'low'

		let response: any;
		let lastError: any;
		let attempt = 0;
		while (attempt <= maxRetries) {
			try {
				response = await makePostRequest(chatUrl, requestBody, apiKey);
				if (hasUsableContent(response)) {
					break;
				}
				if (attempt < maxRetries) {
					await new Promise<void>(resolve => setTimeout(resolve, 500));
				}
			} catch (err) {
				lastError = err;
				if (attempt < maxRetries) {
					await new Promise<void>(resolve => setTimeout(resolve, 500));
				}
			}
			attempt++;
		}

		if (!response || !hasUsableContent(response)) {
			if (lastError) {
				vscode.window.showErrorMessage(`LLM request failed: ${lastError}`);
			} else {
				vscode.window.showInformationMessage('No usable suggestion received from LLM after retries.');
			}
			return;
		}

		const content = extractContent(response);
		const suggestion = cleanSuggestion(content, beforeCursor, afterCursor);
		if (!suggestion) {
			return;
		}

		await editor.edit(editBuilder => {
			const start = position;
			const end = new vscode.Position(currentLine, lineText.length);
			editBuilder.replace(new vscode.Range(start, end), suggestion);
		});
	}

	function makePostRequest(url: string, body: object, apiKey: string): Promise<any> {
		return new Promise((resolve, reject) => {
			const parsedUrl = new URL(url);
			const postData = JSON.stringify(body);

			const options: https.RequestOptions = {
				hostname: parsedUrl.hostname,
				port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? '443' : '80'),
				path: parsedUrl.pathname + parsedUrl.search,
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Content-Length': Buffer.byteLength(postData)
				}
			};

			if (apiKey) {
				options.headers = {
					...options.headers,
					'Authorization': `Bearer ${apiKey}`
				};
			}

			const client = parsedUrl.protocol === 'https:' ? https : http;
			const req = client.request(options, (res: any) => {
				let data = '';
				res.on('data', (chunk: any) => {
					data += chunk;
				});
				res.on('end', () => {
					try {
						resolve(JSON.parse(data));
					} catch (err) {
						reject(new Error('Failed to parse LLM response: ' + data));
					}
				});
			});

			req.on('error', (err: any) => {
				reject(err);
			});

			req.write(postData);
			req.end();
		});
	}

	function hasUsableContent(response: any): boolean {
		if (!response.choices || response.choices.length === 0) {
			return false;
		}
		const message = response.choices[0].message;
		if (!message) {
			return false;
		}
		const content = message.content || response.choices[0].text || '';
		return content.trim().length > 0;
	}

	function extractContent(response: any): string {
		if (response.choices && response.choices.length > 0) {
			return response.choices[0].message?.content || response.choices[0].text || '';
		}
		return '';
	}

	function cleanSuggestion(content: string, beforeCursor: string, afterCursor: string): string {
		let cleaned = content.trim();

		// Remove markdown code fences
		if (cleaned.startsWith('```')) {
			const lines = cleaned.split('\n');
			if (lines.length > 1) {
				lines.shift();
				if (lines[lines.length - 1].trim() === '```') {
					lines.pop();
				}
				cleaned = lines.join('\n').trim();
			} else {
				cleaned = cleaned.replace(/```/g, '').trim();
			}
		}

		// Ensure single line
		cleaned = cleaned.split('\n')[0].trim();

		// Remove cursor marker if present
		cleaned = cleaned.replace(/<CURSOR>/g, '').trim();

		// Remove duplicated prefix already present before cursor
		if (beforeCursor && cleaned.startsWith(beforeCursor)) {
			cleaned = cleaned.substring(beforeCursor.length).trimStart();
		}

		// Remove duplicated suffix already present after cursor
		if (afterCursor && cleaned.endsWith(afterCursor.trim())) {
			cleaned = cleaned.substring(0, cleaned.length - afterCursor.trim().length).trimEnd();
		}

		return cleaned;
	}

	return {
		activate: (context: vscode.ExtensionContext) => {
			CommandActivator.registerAsync(context, [suggest]);
		}
	};
})();
