'use strict';

import * as vscode from 'vscode';
import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';
import { CommandActivator } from './command';

const CONTEXT_LINES_BEFORE = 30;
const CONTEXT_LINES_AFTER = 10;

const CURSOR_MARKER = '<CURSOR>';

export let SuggestCommand = (function() {

	async function suggest(editor: vscode.TextEditor): Promise<void> {
		const config = vscode.workspace.getConfiguration('editext.llm');
		const baseUrl = config.get<string>('baseUrl') || 'http://localhost:1234/v1';
		const apiKey = config.get<string>('apiKey') || ''
		const model = config.get<string>('model') || '';
		const maxRetries = config.get<number>('maxRetries') ?? 3;
		const maxTokens = config.get<number>('maxTokens') ?? 150;
		const temperature = config.get<number>('temperature') ?? 0.1;
		const timeoutMs = config.get<number>('timeout') ?? 30000;

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
				contextLines.push(beforeCursor + CURSOR_MARKER + afterCursor);
			} else {
				contextLines.push(document.lineAt(i).text);
			}
		}
		const context = contextLines.join('\n');

		const language = document.languageId;
		const fileName = document.fileName.split(/[\\/]/).pop() || 'untitled';

		const systemPrompt =
			'You are an expert inline code completion engine. '
			+ 'Given a snippet of code with a `<CURSOR>` marker, predict the exact text the developer is most likely to type next. '
			+ 'Rules:\n'
			+ '- Output ONLY the raw text that should be inserted at `<CURSOR>`.\n'
			+ '- Do NOT output the `<CURSOR>` marker itself.\n'
			+ '- Do NOT output explanations, markdown, or code fences.\n'
			+ '- Stop after finishing the current statement or block; do not continue into new unrelated code.\n'
			+ '- Match the surrounding indentation and style exactly.\n'
			+ '- If the cursor is in the middle of a word, continue that word naturally.';

		const userPrompt =
			`File: ${fileName}\nLanguage: ${language}\n\n`
			+ 'Complete the following code at the `<CURSOR>` position.\n\n'
			+ 'Example:\n'
			+ '```python\n'
			+ 'def greet(name):\n'
			+ '    return "Hello, " + <CURSOR> + "!"\n'
			+ '```\n'
			+ 'Output:\n'
			+ 'name\n\n'
			+ 'Now complete this code:\n'
			+ '```' + language + '\n'
			+ context + '\n'
			+ '```\n'
			+ 'Output:';

		const apiBase = baseUrl.replace(/\/v1\/?$/, '').replace(/\/$/, '');
		const chatUrl = `${apiBase}/v1/chat/completions`;

		const requestBody: any = {
			model: model,
			messages: [
				{ role: 'system', content: systemPrompt },
				{ role: 'user', content: userPrompt }
			],
			max_tokens: maxTokens,
			temperature: temperature,
			enable_thinking: false,
			reasoning_effort: 'low'
//			stop: ['\n\n', '<CURSOR>', '```']
		};

		let response: any;
		let lastError: any;
		let attempt = 0;
		while (attempt <= maxRetries) {
			try {
				response = await makePostRequest(chatUrl, requestBody, apiKey, timeoutMs);
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

	function makePostRequest(url: string, body: object, apiKey: string, timeoutMs: number): Promise<any> {
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

			if (apiKey != '') {
				options.headers = {
					...options.headers,
					'Authorization': `Bearer ${apiKey}`
				};
			}

			const client = parsedUrl.protocol === 'https:' ? https : http;
			let timer: NodeJS.Timeout | undefined;
			const req = client.request(options, (res: any) => {
				let data = '';
				res.on('data', (chunk: any) => {
					data += chunk;
				});
				res.on('end', () => {
					if (timer) { clearTimeout(timer); }
					try {
						resolve(JSON.parse(data));
					} catch (err) {
						reject(new Error('Failed to parse LLM response: ' + data));
					}
				});
				res.on('error', (err: any) => {
					if (timer) { clearTimeout(timer); }
					reject(err);
				});
			});

			timer = setTimeout(() => {
				req.destroy(new Error(`LLM request timed out after ${timeoutMs} ms`));
			}, timeoutMs);

			req.on('error', (err: any) => {
				if (timer) { clearTimeout(timer); }
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
		const choice = response.choices[0];
		const content = choice.message?.content || choice.text || '';
		return content.trim().length > 0;
	}

	function extractContent(response: any): string {
		if (response.choices && response.choices.length > 0) {
			return response.choices[0].message?.content || response.choices[0].text || '';
		}
		return '';
	}

	function cleanSuggestion(content: string, beforeCursor: string, afterCursor: string): string {
		let cleaned = content;

		// Remove markdown fences and the language tag that may follow them
		cleaned = cleaned.replace(/```[a-zA-Z0-9_+-]*\n?/g, '').replace(/```/g, '');

		// Remove the cursor marker if the model echoed it
		cleaned = cleaned.replace(new RegExp(CURSOR_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '');

		// Trim leading blank lines / common prefix label
		cleaned = cleaned.replace(/^(Output:\s*)?/i, '').trimStart();

		// If the model repeats the prefix already present before the cursor, drop it
		const trimmedPrefix = beforeCursor.trim();
		if (trimmedPrefix && cleaned.startsWith(trimmedPrefix)) {
			cleaned = cleaned.substring(trimmedPrefix.length);
		}

		// If the model repeats the suffix already present after the cursor, drop it
		const trimmedSuffix = afterCursor.trim();
		if (trimmedSuffix && cleaned.endsWith(trimmedSuffix)) {
			cleaned = cleaned.substring(0, cleaned.length - trimmedSuffix.length);
		}

		// Remove a single trailing blank line, but keep intentional internal ones
		cleaned = cleaned.replace(/\n\s*$/, '\n').trimEnd();

		return cleaned;
	}

	return {
		activate: (context: vscode.ExtensionContext) => {
			CommandActivator.registerAsync(context, [suggest]);
		}
	};
})();
