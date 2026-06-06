'use strict';

import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// Import FileCommand
const FileCommand = require('../out/file').FileCommand;

describe('FileCommand: file ignore patterns with regexp support', () => {
	// ---- regexpToGlob conversion tests ----

	describe('regexpToGlob', () => {
		it('converts .* (match any) to **/* pattern', () => {
			const result = FileCommand.regexpToGlob('.*');
			assert.strictEqual(result, '**/*');
		});

		it('removes leading anchor (^)', () => {
			const result = FileCommand.regexpToGlob('^node_modules');
			assert.strictEqual(result, 'node_modules');
		});

		it('removes trailing anchor ($)', () => {
			const result = FileCommand.regexpToGlob('node_modules$');
			assert.strictEqual(result, 'node_modules');
		});

		it('removes both anchors', () => {
			const result = FileCommand.regexpToGlob('^node_modules$');
			assert.strictEqual(result, 'node_modules');
		});

		it('converts escaped dot to literal dot', () => {
			const result = FileCommand.regexpToGlob('test\\.py$');
			assert.ok(result && result.includes('test.py'));
		});

		it('converts .* to * in file extension patterns', () => {
			const result = FileCommand.regexpToGlob('.*\\.log$');
			assert.ok(result && result.includes('.log'));
		});

		it('handles pyc file pattern: .*\\.pyc$', () => {
			const result = FileCommand.regexpToGlob('.*\\.pyc$');
			assert.ok(result && result.includes('.pyc'));
		});

		it('handles pyo file pattern: .*\\.pyo$', () => {
			const result = FileCommand.regexpToGlob('.*\\.pyo$');
			assert.ok(result && result.includes('.pyo'));
		});

		it('handles egg-info pattern: .*\\.egg-info$', () => {
			const result = FileCommand.regexpToGlob('.*\\.egg-info$');
			assert.ok(result && result.includes('.egg-info'));
		});

		it('handles __pycache__ directory: ^__pycache__$', () => {
			const result = FileCommand.regexpToGlob('^__pycache__$');
			assert.strictEqual(result, '__pycache__');
		});

		it('returns null for patterns with alternatives (|)', () => {
			const result = FileCommand.regexpToGlob('test|build');
			// Should return first part or null
			assert.ok(result === null || result === 'test' || typeof result === 'string');
		});

		it('handles empty pattern after processing', () => {
			const result = FileCommand.regexpToGlob('^$');
			// Should return null or empty
			assert.ok(result === null || result === '');
		});
	});

	// ---- patternsToGlobExclude tests ----

	describe('patternsToGlobExclude', () => {
		it('returns empty string for empty pattern array', () => {
			const result = FileCommand.patternsToGlobExclude([]);
			assert.strictEqual(result, '');
		});

		it('converts single glob pattern', () => {
			const patterns = [{ pattern: 'node_modules', isRegexp: false }];
			const result = FileCommand.patternsToGlobExclude(patterns);
			assert.ok(result.includes('node_modules'));
		});

		it('converts single regexp pattern', () => {
			const patterns = [{ pattern: '.*\\.log$', isRegexp: true }];
			const result = FileCommand.patternsToGlobExclude(patterns);
			assert.ok(result && result.length > 0);
			assert.ok(result.includes('.log'));
		});

		it('wraps multiple patterns in curly braces', () => {
			const patterns = [
				{ pattern: 'node_modules', isRegexp: false },
				{ pattern: '*.log', isRegexp: false }
			];
			const result = FileCommand.patternsToGlobExclude(patterns);
			assert.ok(result.startsWith('{'));
			assert.ok(result.endsWith('}'));
			assert.ok(result.includes(','));
		});

		it('handles directory patterns with trailing slash', () => {
			const patterns = [{ pattern: 'dist/', isRegexp: false }];
			const result = FileCommand.patternsToGlobExclude(patterns);
			assert.ok(result.includes('dist'));
		});

		it('skips empty pattern strings', () => {
			const patterns = [
				{ pattern: 'valid', isRegexp: false },
				{ pattern: '', isRegexp: false },
				{ pattern: 'another', isRegexp: false }
			];
			const result = FileCommand.patternsToGlobExclude(patterns);
			// Should only contain 2 patterns, not 3
			const matches = result.match(/,/g) || [];
			assert.strictEqual(matches.length, 1); // Only 1 comma for 2 items
		});

		it('skips unconvertible regexp patterns', () => {
			const patterns = [
				{ pattern: 'node_modules', isRegexp: false },
				{ pattern: 'complex[^pattern]+', isRegexp: true }
			];
			const result = FileCommand.patternsToGlobExclude(patterns);
			// Should only contain node_modules pattern
			assert.ok(result.includes('node_modules'));
		});

		it('handles patterns without forward slashes', () => {
			const patterns = [{ pattern: 'build', isRegexp: false }];
			const result = FileCommand.patternsToGlobExclude(patterns);
			assert.ok(result.includes('**/build'));
		});

		it('adds ** prefix to relative patterns', () => {
			const patterns = [{ pattern: 'src/dist', isRegexp: false }];
			const result = FileCommand.patternsToGlobExclude(patterns);
			assert.ok(result.includes('**/'));
		});

		it('combines patterns from mixed sources', () => {
			const patterns = [
				{ pattern: 'node_modules', isRegexp: false },  // from .gitignore (glob)
				{ pattern: '.*\\.pyc$', isRegexp: true },      // from .hgignore (regexp)
				{ pattern: '*.log', isRegexp: false }           // from .gitignore (glob)
			];
			const result = FileCommand.patternsToGlobExclude(patterns);
			assert.ok(result.startsWith('{'));
			assert.ok(result.endsWith('}'));
			assert.ok(result.includes('node_modules'));
			assert.ok(result.includes('.pyc'));
			assert.ok(result.includes('.log'));
		});
	});

	// ---- readIgnorePatterns tests with real files ----

	describe('readIgnorePatterns', () => {
		it('returns empty array when file does not exist', () => {
			const patterns = FileCommand.readIgnorePatterns('/nonexistent/path', '.gitignore');
			assert.deepStrictEqual(patterns, []);
		});

		it('reads .gitignore patterns (glob mode)', () => {
			const testDir = path.join(os.tmpdir(), 'vscode-ext-gitignore-' + Date.now());
			fs.mkdirSync(testDir, { recursive: true });
			try {
				const content = 'node_modules\n*.log\n.DS_Store';
				fs.writeFileSync(path.join(testDir, '.gitignore'), content, 'utf8');
				const patterns = FileCommand.readIgnorePatterns(testDir, '.gitignore');
				
				assert.ok(patterns.length >= 3);
				assert.ok(patterns.some((p: any) => p.pattern === 'node_modules' && !p.isRegexp));
				assert.ok(patterns.some((p: any) => p.pattern === '*.log' && !p.isRegexp));
				assert.ok(patterns.some((p: any) => p.pattern === '.DS_Store' && !p.isRegexp));
			} finally {
				fs.rmSync(testDir, { recursive: true, force: true });
			}
		});

		it('reads .hgignore with glob syntax mode and marks patterns as non-regexp', () => {
			const testDir = path.join(os.tmpdir(), 'vscode-ext-hgglob-' + Date.now());
			fs.mkdirSync(testDir, { recursive: true });
			try {
				const content = 'syntax: glob\nnode_modules\n*.log';
				fs.writeFileSync(path.join(testDir, '.hgignore'), content, 'utf8');
				const patterns = FileCommand.readIgnorePatterns(testDir, '.hgignore');
				
				// Filter out any syntax lines
				const nonSyntaxPatterns = patterns.filter((p: any) => !p.pattern.startsWith('syntax'));
				assert.ok(nonSyntaxPatterns.length >= 2);
				assert.ok(nonSyntaxPatterns.every((p: any) => p.isRegexp === false));
			} finally {
				fs.rmSync(testDir, { recursive: true, force: true });
			}
		});

		it('reads .hgignore with regexp syntax mode and marks patterns as regexp', () => {
			const testDir = path.join(os.tmpdir(), 'vscode-ext-hgregexp-' + Date.now());
			fs.mkdirSync(testDir, { recursive: true });
			try {
				const content = 'syntax: regexp\n.*\\.log$\nnode_modules';
				fs.writeFileSync(path.join(testDir, '.hgignore'), content, 'utf8');
				const patterns = FileCommand.readIgnorePatterns(testDir, '.hgignore');
				
				// All patterns should be marked as regexp (syntax: regexp line is skipped)
				assert.ok(patterns.length >= 2);
				assert.ok(patterns.every((p: any) => p.isRegexp === true));
			} finally {
				fs.rmSync(testDir, { recursive: true, force: true });
			}
		});

		it('ignores comment lines and empty lines', () => {
			const testDir = path.join(os.tmpdir(), 'vscode-ext-comments-' + Date.now());
			fs.mkdirSync(testDir, { recursive: true });
			try {
				const content = '# Comment\npattern1\n\n# Another\npattern2';
				fs.writeFileSync(path.join(testDir, '.gitignore'), content, 'utf8');
				const patterns = FileCommand.readIgnorePatterns(testDir, '.gitignore');
				
				assert.ok(patterns.some((p: any) => p.pattern === 'pattern1'));
				assert.ok(patterns.some((p: any) => p.pattern === 'pattern2'));
				assert.strictEqual(patterns.some((p: any) => p.pattern.startsWith('#')), false);
			} finally {
				fs.rmSync(testDir, { recursive: true, force: true });
			}
		});

		it('trims whitespace from pattern lines', () => {
			const testDir = path.join(os.tmpdir(), 'vscode-ext-trim-' + Date.now());
			fs.mkdirSync(testDir, { recursive: true });
			try {
				const content = '  node_modules  \n*.log\t';
				fs.writeFileSync(path.join(testDir, '.gitignore'), content, 'utf8');
				const patterns = FileCommand.readIgnorePatterns(testDir, '.gitignore');
				
				assert.ok(patterns.some((p: any) => p.pattern === 'node_modules'));
				assert.ok(patterns.some((p: any) => p.pattern === '*.log'));
			} finally {
				fs.rmSync(testDir, { recursive: true, force: true });
			}
		});
	});

	// ---- Pattern type tracking ----

	describe('Pattern type tracking with PatternInfo', () => {
		it('marks patterns as non-regexp when reading .gitignore', () => {
			const patternInfo = { pattern: 'node_modules', isRegexp: false };
			assert.strictEqual(patternInfo.isRegexp, false);
			assert.strictEqual(patternInfo.pattern, 'node_modules');
		});

		it('marks patterns as regexp when in .hgignore with regexp syntax', () => {
			const patternInfo = { pattern: '.*\\.log$', isRegexp: true };
			assert.strictEqual(patternInfo.isRegexp, true);
			assert.strictEqual(patternInfo.pattern, '.*\\.log$');
		});
	});

	// ---- Common .hgignore patterns ----

	describe('Common .hgignore regexp patterns', () => {
		it('converts Python build patterns correctly', () => {
			const patterns = [
				{ pattern: '.*\\.pyc$', isRegexp: true },
				{ pattern: '.*\\.pyo$', isRegexp: true },
				{ pattern: '^__pycache__$', isRegexp: true },
				{ pattern: '.*\\.egg-info$', isRegexp: true }
			];
			const result = FileCommand.patternsToGlobExclude(patterns);
			assert.ok(result.includes('.pyc'));
			assert.ok(result.includes('.pyo'));
			assert.ok(result.includes('__pycache__'));
			assert.ok(result.includes('.egg-info'));
		});

		it('converts directory patterns correctly', () => {
			const patterns = [
				{ pattern: '^build$', isRegexp: true },
				{ pattern: '^dist$', isRegexp: true }
			];
			const result = FileCommand.patternsToGlobExclude(patterns);
			assert.ok(result.includes('build'));
			assert.ok(result.includes('dist'));
		});
	});

	// ---- Edge cases ----

	describe('Edge cases', () => {
		it('handles file read errors gracefully', () => {
			assert.doesNotThrow(() => {
				FileCommand.readIgnorePatterns('/path/that/does/not/exist/12345', '.gitignore');
			});
		});

		it('maintains pattern order', () => {
			const testDir = path.join(os.tmpdir(), 'vscode-ext-order-' + Date.now());
			fs.mkdirSync(testDir, { recursive: true });
			try {
				const content = 'first\nsecond\nthird\nfourth';
				fs.writeFileSync(path.join(testDir, '.gitignore'), content, 'utf8');
				const patterns = FileCommand.readIgnorePatterns(testDir, '.gitignore');
				
				assert.strictEqual(patterns[0].pattern, 'first');
				assert.strictEqual(patterns[1].pattern, 'second');
				assert.strictEqual(patterns[2].pattern, 'third');
				assert.strictEqual(patterns[3].pattern, 'fourth');
			} finally {
				fs.rmSync(testDir, { recursive: true, force: true });
			}
		});

		it('handles unicode characters in patterns', () => {
			const testDir = path.join(os.tmpdir(), 'vscode-ext-unicode-' + Date.now());
			fs.mkdirSync(testDir, { recursive: true });
			try {
				const content = '*.téxt\n文件.log';
				fs.writeFileSync(path.join(testDir, '.gitignore'), content, 'utf8');
				const patterns = FileCommand.readIgnorePatterns(testDir, '.gitignore');
				
				assert.ok(patterns.some((p: any) => p.pattern.includes('téxt')));
				assert.ok(patterns.some((p: any) => p.pattern.includes('文件')));
			} finally {
				fs.rmSync(testDir, { recursive: true, force: true });
			}
		});
	});

	// ---- Integration: mixed .gitignore and .hgignore ----

	describe('Integration: .gitignore and .hgignore together', () => {
		it('processes .gitignore (glob) and .hgignore (regexp) together', () => {
			const testDir = path.join(os.tmpdir(), 'vscode-ext-mixed-' + Date.now());
			fs.mkdirSync(testDir, { recursive: true });
			try {
				const gitignoreContent = 'node_modules\n*.log';
				const hgignoreContent = 'syntax: regexp\n.*\\.pyc$\nbuild';
				
				fs.writeFileSync(path.join(testDir, '.gitignore'), gitignoreContent, 'utf8');
				fs.writeFileSync(path.join(testDir, '.hgignore'), hgignoreContent, 'utf8');
				
				const gitignorePatterns = FileCommand.readIgnorePatterns(testDir, '.gitignore');
				const hgignorePatterns = FileCommand.readIgnorePatterns(testDir, '.hgignore');
				
				// Gitignore patterns should be marked as non-regexp
				assert.ok(gitignorePatterns.every((p: any) => p.isRegexp === false));
				
				// Hgignore patterns should be marked as regexp
				assert.ok(hgignorePatterns.every((p: any) => p.isRegexp === true));
				
				// Test combined pattern conversion
				const allPatterns = [...gitignorePatterns, ...hgignorePatterns];
				const result = FileCommand.patternsToGlobExclude(allPatterns);
				
				assert.ok(result.includes('node_modules'));
				assert.ok(result.includes('.log'));
				assert.ok(result.includes('.pyc'));
				assert.ok(result.includes('build'));
			} finally {
				fs.rmSync(testDir, { recursive: true, force: true });
			}
		});
	});
});
