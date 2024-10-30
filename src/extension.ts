import * as vscode from 'vscode';
import * as fs from 'fs';
import * as xpath from 'xpath';
import { DOMParser } from 'xmldom';
import * as packageJson from '../package.json';
import { assert } from 'console';

namespace xml {
    export function attribute(node: xpath.SelectedValue | string, attributeName: string, defaultValue: string = ""): string {
        const regex = new RegExp(`${attributeName}="([^"]*?)"`, 'i');
        const match = node.toString().match(regex);
        return match ? match[1] : defaultValue;
    }

    export function attributes(node: xpath.SelectedValue | string, attributeNames: string[], defaultValue: string = ""): Record<string, string> {
        const result: Record<string, string> = {};

        for (const attributeName of attributeNames) {
            const regex = new RegExp(`${attributeName}=['"]([^'"]*?)['"]`, 'i');
            const match = node.toString().match(regex);
            result[attributeName] = match ? match[1] : defaultValue;
        }

        return result;
    }
}

namespace cobertura {
    class Line {
        public number: number;
        public hits: number;
        constructor(number: number, hits: number) {
            this.number = number;
            this.hits = hits;
        }
    }

    class Class {
        public name: string;
        public filename: string;
        public lines: Line[];

        constructor(name: string, filename: string, lines: Line[]) {
            this.name = name;
            this.filename = filename;
            this.lines = lines;
        }

        public getHits(): number[] {
            return this.lines
                .filter(line => line.hits > 0)
                .map(line => line.number);
        }

        public getMisses(): number[] {
            return this.lines
                .filter(line => line.hits <= 0)
                .map(line => line.number);
        }
    }

    class Source {
        public text: string;
        constructor(text: string) {
            this.text = text;
        }
    }

    class Package {
        public name: string;
        public classes: Class[];
        constructor(name: string, classes: Class[]) {
            this.name = name;
            this.classes = classes;
        }
    }

    export class Coverage {
        public sources: Source[];
        public packages: Package[];

        constructor(sources: Source[], packages: Package[]) {
            this.sources = sources;
            this.packages = packages;
        }
    }

    export function observableFilesInCoverage(coverage: Coverage): vscode.Uri[] {
        const drives = coverage.sources.map(source => source.text);
        const filenames = coverage.packages.map(pack => pack.classes).flat().map(cls => cls.filename);
        const files = drives.flatMap(drive => filenames.map(filename => vscode.Uri.file([drive.toString(), filename.toString()].join('/'))));
        return files;
    }

    function linesInClass(doc: Document, packageName: string, classFilename: string): Line[] {
        const nodes = xpath.select(`coverage/packages/package[@name = '${packageName}']/classes/class[@filename = '${classFilename}']/lines/line`, doc);
        const lines = nodes.map(node => {
            const attributes = xml.attributes(node, ['number', 'hits']);
            return new Line(parseInt(attributes['number']), parseInt(attributes['hits']));
        });
        return lines;
    }

    function classesInPackage(doc: Document, packageName: string): Class[] {
        const nodes = xpath.select(`coverage/packages/package[@name = '${packageName}']/classes/class`, doc);
        const classes = nodes.map(node => {
            const attributes = xml.attributes(node, ['name', 'filename']);
            const lines = linesInClass(doc, packageName, attributes['filename']);
            return new Class(attributes['name'], attributes['filename'], lines);
        });
        return classes;
    }

    function packagesInDocument(doc: Document): Package[] {
        const nodes = xpath.select(`coverage/packages/package`, doc);
        const packages = nodes.map(node => {
            const name = xml.attribute(node, 'name');
            const classes = classesInPackage(doc, name);
            return new Package(name, classes);
        });
        return packages;
    }

    function sourcesInDocument(doc: Document): Source[] {
        const nodes = xpath.select(`coverage/sources/source/text()`, doc);
        const sources = nodes.map(node => new Source(node.toString()));
        return sources;
    }

    function coverageFromDocument(doc: Document): Coverage {
        const sources = sourcesInDocument(doc);
        const packages = packagesInDocument(doc);
        return new Coverage(sources, packages);
    }

    export function coverageFromFile(uri: vscode.Uri): Coverage {
        const xmlData = fs.readFileSync(uri.fsPath, 'utf-8');
        const doc = new DOMParser().parseFromString(xmlData, 'text/xml');
        return coverageFromDocument(doc);
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
    let activeCoverage: [vscode.Uri, cobertura.Coverage] | undefined;

    // settings
    let decorationTypeH = vscode.window.createTextEditorDecorationType({
        backgroundColor: vscode.workspace.getConfiguration(packageJson.name).get<string>('hitColor')
    });

    let decorationTypeM = vscode.window.createTextEditorDecorationType({
        backgroundColor: vscode.workspace.getConfiguration(packageJson.name).get<string>('missColor')
    });

    const reportPattern = vscode.workspace.getConfiguration(packageJson.name).get<string>('reportPattern');
    context.subscriptions.push(filesystem.createFileSystemWatcher(`**/${reportPattern}`, uri => {
        if (activeCoverage && uri.fsPath === activeCoverage[0].fsPath) {
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

    function coverageInPercent([hits, misses]: [number[], number[]]): number {
        const coveragePercentage = (hits.length / (hits.length + misses.length)) * 100;
        return coveragePercentage;
    }

    function minimumCoverage(): number {
        const minCoverage = vscode.workspace.getConfiguration(packageJson.name).get<string>('minCoverage');
        return minCoverage ? parseFloat(minCoverage) : 80.0;
    }

    function coverageForDisplay(coverage: number): string {
        assert(coverage >= 0 && coverage <= 100);
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

    function initializeCoverage(uri: vscode.Uri) {
        const coverage = cobertura.coverageFromFile(uri);
        activeCoverage = [uri, coverage];
    }

    // commands
    context.subscriptions.push(vscode.commands.registerCommand('coberturahighlighter.selectReport', function () {
        selectReport().then(uri => initializeCoverage(uri)).then(_ => showDecorations(activeEditor ? [activeEditor] : []));
    }));

    context.subscriptions.push(vscode.commands.registerCommand('coberturahighlighter.showCoverage', function () {
        if (!activeCoverage) {
            selectReport().then(uri => initializeCoverage(uri)).then(_ => showDecorations(activeEditor ? [activeEditor] : []));
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
        if (editor && activeCoverage) {
            const observable = cobertura.observableFilesInCoverage(activeCoverage[1]).map(uri => uri.fsPath);
            const fsPath = editor.document.uri.fsPath;
            if (observable.includes(fsPath)) {
                showDecorations([editor]);
            }
            else {
                hideDecorations([editor]);
            }
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
            if (!activeCoverage) {
                return;
            }
            const filename = editor.document.uri.fsPath;
            const classes = activeCoverage[1].packages.map(pkg => pkg.classes).flat().filter(cls => filename.endsWith(cls.filename));
            const hits = classes.map(cls => cls.getHits()).flat();
            const misses = classes.map(cls => cls.getMisses()).flat();

            showLineHighlights(editor, [hits, misses]);
            showDiagnostics(editor.document, [hits, misses]);
            if (editor === activeEditor) {
                showStatusBar([hits, misses]);
            }
        });
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
