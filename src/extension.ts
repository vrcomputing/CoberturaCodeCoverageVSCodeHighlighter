import * as vscode from 'vscode';
import * as fs from 'fs';
import * as xpath from 'xpath';
import { DOMParser } from 'xmldom';

export function activate(context: vscode.ExtensionContext) {
    // initial decorations
    let activeEditor = vscode.window.activeTextEditor;
    if (activeEditor) {
        triggerUpdateDecorations(activeEditor.document.uri);
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

    context.subscriptions.push(vscode.commands.registerCommand('coberturahighlighter.showCoverage', function () {
        const filename = vscode.window.activeTextEditor?.document.uri;
        if (!filename) { return; };

        vscode.workspace.findFiles('**/*.cobertura').then(options => {
            vscode.window.showQuickPick(options.map(uri => uri.fsPath),).then(option => {
                if (option && option.length !== 0) {
                    triggerUpdateDecorations(filename, vscode.Uri.file(option));
                }
            });
        });
    }));

    vscode.window.onDidChangeActiveTextEditor(editor => {
        activeEditor = editor;
        if (editor) {
            triggerUpdateDecorations(editor.document.uri);
        }
    }, null, context.subscriptions);

    vscode.workspace.onDidChangeTextDocument(event => {
        if (activeEditor && event.document === activeEditor.document) {
            triggerUpdateDecorations(activeEditor.document.uri);
        }
    }, null, context.subscriptions);

    // TODO how to use absolute directory
    let watcher = vscode.workspace.createFileSystemWatcher(`**/*.xml`);
    watcher.onDidChange(uri => {
        triggerFileSystemChange(uri);
    });
    watcher.onDidCreate(uri => {
        triggerFileSystemChange(uri);
    });
    watcher.onDidDelete(uri => {
        triggerFileSystemChange(uri, true);
    });

    context.subscriptions.push(watcher);

    // report->(source,content)
    const coverageReports = new Map<string, Map<string, string>>();

    function triggerFileSystemChange(uri: vscode.Uri, remove: boolean = false) {
        if (remove) {
            coverageReports.delete(uri.fsPath);
        } else {
            try {
                const fileContent = fs.readFileSync(uri.fsPath, 'utf-8');
                if (!coverageReports.has(uri.fsPath)) {
                    coverageReports.set(uri.fsPath, new Map<string, string>());
                }

                const nestedMap = coverageReports.get(uri.fsPath)!;
                nestedMap.set('content', fileContent);
            } catch (error) {
                console.error(`Error reading file ${uri.fsPath}:`, error);
            }
        }
    }

    function triggerUpdateDecorations(filename: vscode.Uri, cobertura?: vscode.Uri) {
        if (!activeEditor || activeEditor.document.languageId !== 'cpp' || activeEditor.document.uri !== filename) {
            return;
        }

        if (!cobertura) { return; }

        hitsAndMissesForFiles(filename, cobertura).then(([hits, misses]) => {
            const decorationsH: vscode.DecorationOptions[] = [];
            const decorationsM: vscode.DecorationOptions[] = [];

            hits.forEach(line => {
                const startPos = new vscode.Position(line, 0);
                const textLine = activeEditor?.document.lineAt(line);
                if (textLine) {
                    const endPos = new vscode.Position(line, textLine.text.length);
                    const decoration = { range: new vscode.Range(startPos, endPos) };
                    decorationsH.push(decoration);
                }
            });

            misses.forEach(line => {
                const startPos = new vscode.Position(line, 0);
                const textLine = activeEditor?.document.lineAt(line);
                if (textLine) {
                    const endPos = new vscode.Position(line, textLine.text.length);
                    const decoration = { range: new vscode.Range(startPos, endPos) };
                    decorationsM.push(decoration);
                }
            });

            let decorationTypeH = vscode.window.createTextEditorDecorationType({
                backgroundColor: vscode.workspace.getConfiguration('myExtension').get<string>('hitColor')
            });

            let decorationTypeM = vscode.window.createTextEditorDecorationType({
                backgroundColor: vscode.workspace.getConfiguration('myExtension').get<string>('missColor')
            });

            activeEditor?.setDecorations(decorationTypeH, decorationsH);
            activeEditor?.setDecorations(decorationTypeM, decorationsM);
        });
    }
}

export function deactivate() { }
