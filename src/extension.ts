import * as vscode from 'vscode';
import * as fs from 'fs';
import * as xpath from 'xpath';
import { DOMParser } from 'xmldom';
import * as packageJson from '../package.json';

export function activate(context: vscode.ExtensionContext) {
    // initial decorations
    let activeEditor = vscode.window.activeTextEditor;
    if (activeEditor) {
        // TODO
    }

    // settings
    let decorationTypeH = vscode.window.createTextEditorDecorationType({
        backgroundColor: vscode.workspace.getConfiguration(packageJson.name).get<string>('hitColor')
    });

    let decorationTypeM = vscode.window.createTextEditorDecorationType({
        backgroundColor: vscode.workspace.getConfiguration(packageJson.name).get<string>('missColor')
    });

    const reportPattern = vscode.workspace.getConfiguration(packageJson.name).get<string>('reportPattern');

    const diagnosticCollection = vscode.languages.createDiagnosticCollection('codeCoverage');
    context.subscriptions.push(diagnosticCollection);

    const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBar.text = '';
    context.subscriptions.push(statusBar);

    function updateDiagnostics(document: vscode.TextDocument, [hits, misses]: [number[], number[]]) {
        if (!languages().includes(document.languageId)) {
            return;
        }

        // update status bar
        const coveragePercentageMin = 80;
        const coveragePercentage = (hits.length / (hits.length + misses.length)) * 100;
        const coverageInfo = `Coverage: ${coveragePercentage.toFixed(2)}%`;
        const coverageIcon = coveragePercentage >= coveragePercentageMin ? '$(check)' : '$(warning)';
        statusBar.text = `${coverageIcon} ${coverageInfo}`;
        statusBar.color = coveragePercentage >= coveragePercentageMin ? '#4CAF50' : '#fcba04';
        statusBar.show();

        const diagnostics: vscode.Diagnostic[] = [];
        const diagnosticSource = 'Code Coverage';

        if (misses.length > 0) {
            const diagnostic = new vscode.Diagnostic(
                new vscode.Range(
                    document.positionAt(0),
                    document.positionAt(0)
                ),
                `File is not covered sufficiently (${coveragePercentage.toFixed(2)}/${coveragePercentageMin.toFixed(2)}%):`,
                vscode.DiagnosticSeverity.Warning
            );
            diagnostic.source = diagnosticSource;
            diagnostics.push(diagnostic);
        }

        // Loop through missed lines and create diagnostics
        misses.forEach(lineNumber => {
            const range = new vscode.Range(
                new vscode.Position(lineNumber, 0),
                new vscode.Position(lineNumber, document.lineAt(lineNumber).text.length)
            );

            const diagnostic = new vscode.Diagnostic(
                range,
                `Line ${lineNumber + 1} is not covered by tests.`,
                vscode.DiagnosticSeverity.Warning
            );

            diagnostic.source = diagnosticSource;
            diagnostics.push(diagnostic);
        });

        // Set diagnostics for the current document
        diagnosticCollection.set(document.uri, diagnostics);
    }

    function filesInReport(report: vscode.Uri): Promise<vscode.Uri[]> {
        return new Promise((resolve) => {
            const xmlData = fs.readFileSync(report.fsPath, 'utf-8');
            const doc = new DOMParser().parseFromString(xmlData, 'text/xml');
            const sources = xpath.select(`coverage/sources/source/text()`, doc);
            const drives: string[] = sources.map(drive => drive.toString().replace(/.*"(.*)".*/, '$1'));
            const filenames = xpath.select(`coverage/packages/package/classes/class/@filename`, doc);
            const files: string[] = filenames.map(filename => filename.toString().replace(/.*"(.*)".*/, '$1'));
            const allFiles = drives.flatMap(el1 => files.map(el2 => vscode.Uri.file([el1.toString(), el2.toString()].join('/'))));
            resolve(allFiles);
        });
    }

    function hitsAndMissesForFiles(source: vscode.Uri, cobertura: vscode.Uri): Promise<[number[], number[]]> {
        return new Promise((resolve) => {
            const xmlData = fs.readFileSync(cobertura.fsPath, 'utf-8');
            const doc = new DOMParser().parseFromString(xmlData, 'text/xml');
            const file = source.fsPath.replace(/^[a-zA-Z]:\\/, '');
            const query = `coverage/packages/package/classes/class[@filename = '${file}']/lines/line`;
            const linesNodes = xpath.select(query, doc);

            const hitsArray: number[] = [];
            const missesArray: number[] = [];

            linesNodes.forEach(node => {
                const nodeAsString = node.toString();
                // TODO how to get node attribute?
                const match = nodeAsString.match(/<line number="(\d+)" hits="(\d+)"\/>/);
                if (match) {
                    const number = parseInt(match[1]) - 1;
                    const hits = parseInt(match[2]);
                    if (hits > 0) { hitsArray.push(number); }
                    else {
                        missesArray.push(number);
                    }
                }
            });

            resolve([hitsArray, missesArray]);
        });
    }

    function selectReport(): Promise<vscode.Uri> {
        return new Promise((resolve) => {
            vscode.workspace.findFiles(`**/${reportPattern}`).then(options => {
                vscode.window.showQuickPick(options.map(uri => uri.fsPath)).then(option => {
                    if (option && option.length !== 0) {
                        resolve(vscode.Uri.file(option));
                    }
                });
            });
        });
    }

    function showDecorationsAll(editors: readonly vscode.TextEditor[] = vscode.window.visibleTextEditors) {
        selectReport().then(uri => {
            showDecorations(uri, editors);
        });
    }

    // commands

    context.subscriptions.push(vscode.commands.registerCommand('coberturahighlighter.showCoverageAll', function () {
        showDecorationsAll();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('coberturahighlighter.showCoverage', function () {
        showDecorationsAll(activeEditor ? [activeEditor] : []);
    }));

    context.subscriptions.push(vscode.commands.registerCommand('coberturahighlighter.hideCoverageAll', function () {
        hideDecorations();
    }));

    context.subscriptions.push(vscode.commands.registerCommand('coberturahighlighter.hideCoverage', function () {
        hideDecorations(activeEditor ? [activeEditor] : []);
    }));

    context.subscriptions.push(vscode.commands.registerCommand('coberturahighlighter.showCoverageForReport', function () {
        vscode.workspace.findFiles(`**/${reportPattern}`).then(options => {
            vscode.window.showQuickPick(options.map(uri => uri.fsPath)).then(option => {
                if (option && option.length !== 0) {
                    filesInReport(vscode.Uri.file(option)).then(files => {
                        files.forEach(file => {
                            vscode.workspace.openTextDocument(file).then((document) => {
                                vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.Active, preview: false }).then(editor => {
                                    showDecorations(vscode.Uri.file(option), [editor]);
                                });
                            });
                        });
                    });
                }
            });
        });
    }));

    vscode.window.onDidChangeActiveTextEditor(editor => {
        activeEditor = editor;
        if (editor) {
            // TODO
        }
    }, null, context.subscriptions);

    vscode.workspace.onDidChangeTextDocument(event => {
        if (activeEditor && event.document === activeEditor.document) {
            hideDecorations(activeEditor ? [activeEditor] : []);
        }
    }, null, context.subscriptions);

    // Clear diagnostics when a file is closed
    vscode.workspace.onDidCloseTextDocument(
        (document) => diagnosticCollection.delete(document.uri),
        null,
        context.subscriptions
    );

    function decorationsForHitsAndMisses([hits, misses]: [number[], number[]]) {
        const createDecorations = (lines: number[]) => {
            return lines.flatMap(line => {
                const startPos = new vscode.Position(line, 0);
                const textLine = activeEditor?.document.lineAt(line);
                if (!textLine) { return []; }
                const endPos = new vscode.Position(line, textLine.text.length);
                return { range: new vscode.Range(startPos, endPos) };
            });
        };

        const decorationsH = createDecorations(hits);
        const decorationsM = createDecorations(misses);

        return [decorationsH, decorationsM];
    }

    function languages(): string[] {
        return ['cpp', 'c'];
    }

    function showDecorations(report: vscode.Uri, editors: readonly vscode.TextEditor[] = vscode.window.visibleTextEditors) {
        editors.forEach(editor => {
            if (languages().includes(editor.document.languageId)) {
                hitsAndMissesForFiles(editor.document.uri, report).then(([hits, misses]) => {
                    const [decorationsH, decorationsM] = decorationsForHitsAndMisses([hits, misses]);
                    editor.setDecorations(decorationTypeH, decorationsH);
                    editor.setDecorations(decorationTypeM, decorationsM);
                    updateDiagnostics(editor.document, [hits, misses]);
                });
            }
        });
    }

    function hideDecorations(editors: readonly vscode.TextEditor[] = vscode.window.visibleTextEditors) {
        editors.forEach(editor => {
            if (languages().includes(editor.document.languageId)) {
                editor.setDecorations(decorationTypeH, []);
                editor.setDecorations(decorationTypeM, []);
            }
        });
    }
}

export function deactivate() { }
