// Register tsconfig-paths with the test tsconfig so 'vscode' resolves to the mock
const tsConfigPaths = require('tsconfig-paths');
const path = require('path');

const result = tsConfigPaths.loadConfig(path.resolve(__dirname, '..', 'tsconfig.test.json'));
if (result.resultType === 'success') {
	tsConfigPaths.register({
		baseUrl: result.absoluteBaseUrl,
		paths: result.paths,
	});
}
