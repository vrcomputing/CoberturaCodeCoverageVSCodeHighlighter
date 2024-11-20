import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

namespace treeview {
    export class MyTreeItem extends vscode.TreeItem {
        constructor(label: string, description: string, uri: vscode.Uri) {
            super(label, vscode.TreeItemCollapsibleState.None);
            this.description = description;
            this.command = {
                command: 'vscode.open',
                title: 'Open File',
                arguments: [uri]
            };
            this.resourceUri = uri;
        }
    }

    export class MyTreeDataProvider implements vscode.TreeDataProvider<MyTreeItem> {

        private _onDidChangeTreeData: vscode.EventEmitter<MyTreeItem | undefined | void> = new vscode.EventEmitter<MyTreeItem | undefined | void>();
        readonly onDidChangeTreeData: vscode.Event<MyTreeItem | undefined | void> = this._onDidChangeTreeData.event;
        private provider: () => MyTreeItem[];

        constructor(items: () => MyTreeItem[]) {
            this.provider = items;
        }

        getTreeItem(element: MyTreeItem): vscode.TreeItem {
            return element;
        }

        getChildren(element?: MyTreeItem): Thenable<MyTreeItem[]> {
            if (element) {
                return Promise.resolve([]);
            } else {
                return Promise.resolve(this.provider());
            }
        }

        public refresh(): void {
            this._onDidChangeTreeData.fire();
        }
    }
}

namespace filesystem {
    export function createFileSystemWatcher(globPattern: vscode.GlobPattern, onDidChange?: (uri: vscode.Uri) => any, onDidCreate?: (uri: vscode.Uri) => any, onDidDelete?: (uri: vscode.Uri) => any): vscode.FileSystemWatcher {
        const watcher = vscode.workspace.createFileSystemWatcher(globPattern);
        if (onDidChange) {
            watcher.onDidChange(onDidChange);
        }
        if (onDidCreate) {
            watcher.onDidChange(onDidCreate);
        }
        if (onDidDelete) {
            watcher.onDidChange(onDidDelete);
        }
        return watcher;
    }
}

export function activate(context: vscode.ExtensionContext) {
    // initial decorations
    let activeEditor = vscode.window.activeTextEditor;
    if (activeEditor) {
        // TODO
    }

    // report->filenames
    let activeCoverage = new Map<string, [number, number][]>();

    // settings
    let decorationTypeH = vscode.window.createTextEditorDecorationType({
        backgroundColor: vscode.workspace.getConfiguration("coberturahighlighter").get<string>('hitColor')
    });

    let decorationTypeM = vscode.window.createTextEditorDecorationType({
        backgroundColor: vscode.workspace.getConfiguration("coberturahighlighter").get<string>('missColor')
    });

    const reportPattern = vscode.workspace.getConfiguration("coberturahighlighter").get<string>('reportPattern');
    context.subscriptions.push(filesystem.createFileSystemWatcher(`**/${reportPattern}`, uri => {
        if (uri.fsPath in activeCoverage.keys()) {
            hideDecorations(vscode.window.visibleTextEditors);
            initializeCoverage(uri);
            showDecorations(vscode.window.visibleTextEditors);
        }
    }));

    const diagnosticCollection = vscode.languages.createDiagnosticCollection('codeCoverage');
    context.subscriptions.push(diagnosticCollection);

    const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBar.text = '';
    context.subscriptions.push(statusBar);

    const treeDataProvider = new treeview.MyTreeDataProvider(() => {
        const items: treeview.MyTreeItem[] = [];
        for (let key of activeCoverage.keys()) {
            const stats = activeCoverage.get(key);
            if (stats) {
                const hits = stats.filter(([_, hits]) => { return hits > 0; }).map(([number, _]) => number);
                const misses = stats.filter(([_, hits]) => { return hits <= 0; }).map(([number, _]) => number);
                const coverage = coverageInPercent([hits, misses]);
                const uri = vscode.Uri.file(key);
                const workspaces = vscode.workspace.workspaceFolders;
                let relative = key;
                if (workspaces) {
                    relative = path.relative(workspaces[0].uri.fsPath, key);
                }

                const percent = coverageForDisplay(coverage);
                items.push(new treeview.MyTreeItem(relative, `${percent}/${minimumCoverage()}%`, uri));
            }
        }
        return items;
    });
    vscode.window.createTreeView('cccTreeView', { treeDataProvider });

    function coverageInPercent([hits, misses]: [number[], number[]]): number {
        const coveragePercentage = (hits.length / (hits.length + misses.length)) * 100;
        return coveragePercentage;
    }

    function minimumCoverage(): number {
        const minCoverage = vscode.workspace.getConfiguration("coberturahighlighter").get<string>('minCoverage');
        return minCoverage ? parseFloat(minCoverage) : 80.0;
    }

    function coverageForDisplay(coverage: number): string {
        return `${coverage.toFixed(2)}`;
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

    function initializeCoverage(uri: vscode.Uri): Promise<Map<string, [number, number][]>> {
        return new Promise((resolve) => {
            vscode.workspace.openTextDocument(uri).then(doc => {
                const drives: string[] = [];
                const files = new Map<string, [number, number][]>();
                let currentFile: string = "";

                for (let i = 0; i < doc.lineCount; i++) {
                    const lineText = doc.lineAt(i).text;
                    let match: RegExpMatchArray | null;

                    // Match for <source> tags
                    match = lineText.match(/<source>(\w[:])<\/source>/);
                    if (match) {
                        drives.push(match[1].toLowerCase());
                    }

                    // Match for <class> tags
                    match = lineText.match(/\s*<class name="([^"]+)" filename="([^"]+)" line-rate="(\d[.]\d+)"/);
                    if (match) {
                        currentFile = match[2];
                        files.set(currentFile, []);
                    }

                    // Match for <line> tags
                    match = lineText.match(/\s*<line number="(\d+)" hits="(\d+)"\/>/);
                    if (match && currentFile) {
                        files.get(currentFile)?.push([parseInt(match[1]), parseInt(match[2])]);
                    }
                }

                const report = new Map<string, [number, number][]>();
                for (const drive of drives) {
                    for (const [file, stats] of files) {
                        const filename = `${drive}\\${file}`;
                        const key = vscode.Uri.file(filename).fsPath;
                        if (fs.existsSync(key)) {
                            report.set(key, stats ? stats : []);
                        }
                    }
                }

                resolve(report);
            });
        });
    }

    // commands
    context.subscriptions.push(vscode.commands.registerCommand('coberturahighlighter.selectReport', function () {
        selectReport().then(uri => {
            initializeCoverage(uri).then(report => {
                activeCoverage = report;
                showDecorations(activeEditor ? [activeEditor] : []);
            });
        });
    }));

    context.subscriptions.push(vscode.commands.registerCommand('coberturahighlighter.showCoverage', function () {
        if (activeCoverage.size === 0) {
            selectReport().then(uri => {
                initializeCoverage(uri).then(report => {
                    activeCoverage = report;
                    showDecorations(activeEditor ? [activeEditor] : []);
                });
            });
        }
        else {
            showDecorations(activeEditor ? [activeEditor] : []);
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('coberturahighlighter.hideCoverage', function () {
        hideDecorations(activeEditor ? [activeEditor] : []);
    }));

    vscode.window.onDidChangeActiveTextEditor(editor => {
        activeEditor = editor;

        if (activeEditor && activeCoverage.has(activeEditor.document.uri.fsPath)) {
            showDecorations([activeEditor]);
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

    function rangesForLines(doc: vscode.TextDocument, lines: number[]): vscode.Range[] {
        if (!doc) {
            return [];
        }
        const ranges = lines
            .map(line => line - 1) // cobertura lines : [1, document.lineCount]
            .filter(line => line >= 0 && line < doc.lineCount) // vscode lines : [0, document.lineCount)
            .map(line => {
                const startPos = new vscode.Position(line, 0);
                const textLine = doc.lineAt(line);
                const endPos = new vscode.Position(line, textLine.text.length);
                return new vscode.Range(startPos, endPos);
            });

        return ranges;
    }

    function rangesForHitsAndMisses(doc: vscode.TextDocument, [hits, misses]: [number[], number[]]) {
        const decorationsH = rangesForLines(doc, hits);
        const decorationsM = rangesForLines(doc, misses);
        return [decorationsH, decorationsM];
    }

    function languages(): string[] {
        return ['cpp', 'c'];
    }

    function updateStatusBar([hits, misses]: [number[], number[]]) {
        if (!hits || !hits.length || !misses || !misses.length) {
            statusBar.hide();
        }
        else {
            const coveragePercentageMin = minimumCoverage();
            const coveragePercentage = coverageInPercent([hits, misses]);
            const coverageInfo = `Coverage: ${coverageForDisplay(coveragePercentage)}%`;
            const coverageIcon = coveragePercentage >= coveragePercentageMin ? '$(check)' : '$(warning)';
            statusBar.text = `${coverageIcon} ${coverageInfo}`;
            statusBar.show();
        }
    }

    function showStatusBar([hits, misses]: [number[], number[]]) {
        updateStatusBar([hits, misses]);
    }

    function hideStatusBar() {
        updateStatusBar([[], []]);
    }

    function updateDiagnostics(document: vscode.TextDocument, [hits, misses]: [number[], number[]]) {
        if (!languages().includes(document.languageId)) {
            return;
        }

        const coveragePercentageMin = minimumCoverage();
        const coveragePercentage = coverageInPercent([hits, misses]);

        const diagnostics: vscode.Diagnostic[] = [];
        const diagnosticSource = 'Code Coverage';

        if (coveragePercentage < coveragePercentageMin) {
            const diagnostic = new vscode.Diagnostic(
                new vscode.Range(
                    document.positionAt(0),
                    document.positionAt(0)
                ),
                `File is not covered sufficiently (${coverageForDisplay(coveragePercentage)}/${coverageForDisplay(coveragePercentageMin)}%):`,
                vscode.DiagnosticSeverity.Warning
            );
            diagnostic.source = diagnosticSource;
            diagnostics.push(diagnostic);
        }

        diagnosticCollection.set(document.uri, diagnostics);
    }

    function showDiagnostics(document: vscode.TextDocument, [hits, misses]: [number[], number[]]) {
        updateDiagnostics(document, [hits, misses]);
    }

    function hideDiagnostics(document: vscode.TextDocument) {
        updateDiagnostics(document, [[], []]);
    }

    function updateLineHighlights(editor: vscode.TextEditor, [hits, misses]: [number[], number[]]) {
        if (!hits || !hits.length || !misses || !misses.length) {
            editor.setDecorations(decorationTypeH, []);
            editor.setDecorations(decorationTypeM, []);
        }
        else {
            const [decorationsH, decorationsM] = rangesForHitsAndMisses(editor.document, [hits, misses]);
            editor.setDecorations(decorationTypeH, decorationsH);
            editor.setDecorations(decorationTypeM, decorationsM);
        }
    }

    function showLineHighlights(editor: vscode.TextEditor, [hits, misses]: [number[], number[]]) {
        updateLineHighlights(editor, [hits, misses]);
    }

    function hideLineHighlights(editor: vscode.TextEditor) {
        updateLineHighlights(editor, [[], []]);
    }

    function showDecorations(editors: readonly vscode.TextEditor[] = vscode.window.visibleTextEditors) {
        editors.forEach(editor => {
            for (const [filename, _] of activeCoverage) {
                if (filename === editor.document.uri.fsPath) {
                    const stats = activeCoverage.get(filename);
                    if (stats) {
                        const hits: number[] = [];
                        stats.filter(([_, hits]) => { return hits > 0; }).map(([number, _]) => hits.push(number));
                        const misses: number[] = [];
                        stats.filter(([_, hits]) => { return hits <= 0; }).map(([number, _]) => misses.push(number));
                        showLineHighlights(editor, [hits, misses]);
                        showDiagnostics(editor.document, [hits, misses]);
                        if (editor === activeEditor) {
                            showStatusBar([hits, misses]);
                        }
                    }
                }
            }
        });
        treeDataProvider.refresh();
    }

    function hideDecorations(editors: readonly vscode.TextEditor[] = vscode.window.visibleTextEditors) {
        editors.forEach(editor => {
            hideLineHighlights(editor);
            hideDiagnostics(editor.document);
            hideStatusBar();
        });
    }
}

export function deactivate() { }
