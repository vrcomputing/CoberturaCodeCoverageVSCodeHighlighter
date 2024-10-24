import * as vscode from 'vscode';
import * as fs from 'fs';
import * as xpath from 'xpath';
import { DOMParser } from 'xmldom';

export function activate(context: vscode.ExtensionContext) {
    // initial decorations
    let activeEditor = vscode.window.activeTextEditor;
    if (activeEditor) {
        // TODO
    }

    // settings

    let decorationTypeH = vscode.window.createTextEditorDecorationType({
        backgroundColor: vscode.workspace.getConfiguration('myExtension').get<string>('hitColor')
    });

    let decorationTypeM = vscode.window.createTextEditorDecorationType({
        backgroundColor: vscode.workspace.getConfiguration('myExtension').get<string>('missColor')
    });

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

    function showDecorationsAll(editors: readonly vscode.TextEditor[] = vscode.window.visibleTextEditors) {
        vscode.workspace.findFiles('**/*.cobertura').then(options => {
            vscode.window.showQuickPick(options.map(uri => uri.fsPath)).then(option => {
                if (option && option.length !== 0) {
                    showDecorations(vscode.Uri.file(option), editors);
                }
            });
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
