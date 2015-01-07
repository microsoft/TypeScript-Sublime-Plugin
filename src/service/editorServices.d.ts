/// <reference path="../../node_modules/typescript/bin/typescript.d.ts" />
/// <reference path="../../node_modules/typescript/bin/typescript_internal.d.ts" />
/// <reference path="node.d.ts" />
import ts = require('typescript');
export declare function printLine(s: string): void;
export declare class ScriptInfo {
    filename: string;
    content: string;
    isOpen: boolean;
    svc: ScriptVersionCache;
    isRoot: boolean;
    children: ScriptInfo[];
    activeProject: Project;
    constructor(filename: string, content: string, isOpen?: boolean);
    addChild(childInfo: ScriptInfo): void;
    snap(): LineIndexSnapshot;
    editContent(minChar: number, limChar: number, newText: string): void;
    getTextChangeRangeBetweenVersions(startVersion: number, endVersion: number): ts.TextChangeRange;
    getChangeRange(oldSnapshot: ts.IScriptSnapshot): ts.TextChangeRange;
}
export declare class CancellationToken {
    static None: CancellationToken;
    requestPending: boolean;
    constructor();
    cancel(): void;
    reset(): void;
    isCancellationRequested(): boolean;
}
export declare class LSHost implements ts.LanguageServiceHost {
    private cancellationToken;
    private ls;
    logger: ts.Logger;
    private compilationSettings;
    private filenameToScript;
    constructor(cancellationToken?: CancellationToken);
    trace(str: string): void;
    error(str: string): void;
    cancel(): void;
    reset(): void;
    addDefaultLibrary(): void;
    getScriptSnapshot(filename: string): ts.IScriptSnapshot;
    getCompilationSettings(): ts.CompilerOptions;
    getScriptFileNames(): string[];
    getScriptVersion(filename: string): string;
    getLocalizedDiagnosticMessages(): string;
    getCancellationToken(): ts.CancellationToken;
    getCurrentDirectory(): string;
    getDefaultLibFilename(): string;
    getScriptIsOpen(filename: string): boolean;
    addFile(name: string): void;
    getScriptInfo(filename: string): ScriptInfo;
    addScriptInfo(info: ScriptInfo): ScriptInfo;
    addScript(filename: string, content: string): ScriptInfo;
    saveTo(filename: string, tmpfilename: string): void;
    reloadScript(filename: string, tmpfilename: string, cb: () => any): void;
    editScript(filename: string, minChar: number, limChar: number, newText: string): void;
    resolvePath(path: string): string;
    fileExists(path: string): boolean;
    directoryExists(path: string): boolean;
    log(s: string): void;
    /**
     * @param line 1 based index
     * @param col 1 based index
     */
    lineColToPosition(filename: string, line: number, col: number): number;
    /**
     * @param line 0 based index
     * @param offset 0 based index
     */
    positionToZeroBasedLineCol(filename: string, position: number): ILineInfo;
}
export declare class Project {
    root: ScriptInfo;
    compilerService: CompilerService;
    constructor(root: ScriptInfo);
    addGraph(scriptInfo: ScriptInfo): void;
    addScript(info: ScriptInfo): ScriptInfo;
    printFiles(): void;
}
export declare class ProjectService {
    filenameToScriptInfo: ts.Map<ScriptInfo>;
    roots: ScriptInfo[];
    projects: Project[];
    rootsChanged: boolean;
    newRootDisjoint: boolean;
    lastRemovedRoots: ScriptInfo[];
    getProjectForFile(filename: string): Project;
    printProjects(): void;
    removeRoot(info: ScriptInfo): boolean;
    openProjectFile(pfilename: string): void;
    openSpecifiedFile(filename: string): ScriptInfo;
    /**
     * @param filename is absolute pathname
     */
    openFile(filename: string, possibleRoot?: boolean): ScriptInfo;
}
export declare class CompilerService {
    cancellationToken: CancellationToken;
    host: LSHost;
    languageService: ts.LanguageService;
    classifier: ts.Classifier;
    settings: ts.CompilerOptions;
    documentRegistry: ts.DocumentRegistry;
    formatCodeOptions: ts.FormatCodeOptions;
    constructor();
    isExternalModule(filename: string): boolean;
}
export interface LineCollection {
    charCount(): number;
    lineCount(): number;
    isLeaf(): boolean;
    walk(rangeStart: number, rangeLength: number, walkFns: ILineIndexWalker): void;
    print(indentAmt: number): void;
}
export interface ILineInfo {
    line: number;
    offset: number;
    text?: string;
    leaf?: LineLeaf;
}
export declare enum CharRangeSection {
    PreStart = 0,
    Start = 1,
    Entire = 2,
    Mid = 3,
    End = 4,
    PostEnd = 5,
}
export interface ILineIndexWalker {
    goSubtree: boolean;
    done: boolean;
    leaf(relativeStart: number, relativeLength: number, lineCollection: LineLeaf): void;
    pre?(relativeStart: number, relativeLength: number, lineCollection: LineCollection, parent: LineNode, nodeType: CharRangeSection): LineCollection;
    post?(relativeStart: number, relativeLength: number, lineCollection: LineCollection, parent: LineNode, nodeType: CharRangeSection): LineCollection;
}
export declare class TextChange {
    pos: number;
    deleteLen: number;
    insertedText: string;
    constructor(pos: number, deleteLen: number, insertedText?: string);
    getTextChangeRange(): ts.TextChangeRange;
}
export declare class ScriptVersionCache {
    changes: TextChange[];
    versions: LineIndexSnapshot[];
    private currentVersion;
    static changeNumberThreshold: number;
    static changeLengthThreshold: number;
    edit(pos: number, deleteLen: number, insertedText?: string): void;
    applyEdScript(edScript: string): void;
    latest(): LineIndexSnapshot;
    latestVersion(): number;
    editWithDiff(tmpfilename: string, cb?: () => any): void;
    reloadFromFile(filename: string, cb: () => any): void;
    reloadNoHistory(filename: string): void;
    reload(script: string): void;
    getSnapshot(): LineIndexSnapshot;
    getTextChangesBetweenVersions(oldVersion: number, newVersion: number): ts.TextChangeRange;
    static fromString(script: string): ScriptVersionCache;
}
export declare class LineIndexSnapshot implements ts.IScriptSnapshot {
    version: number;
    cache: ScriptVersionCache;
    index: LineIndex;
    changesSincePreviousVersion: TextChange[];
    reloaded: boolean;
    constructor(version: number, cache: ScriptVersionCache);
    getText(rangeStart: number, rangeEnd: number): string;
    getLength(): number;
    getLineStartPositions(): number[];
    getLineMapper(): (line: number) => number;
    getTextChangeRangeSinceVersion(scriptVersion: number): ts.TextChangeRange;
    getChangeRange(oldSnapshot: ts.IScriptSnapshot): ts.TextChangeRange;
}
export declare class LineIndex {
    root: LineNode;
    checkEdits: boolean;
    charOffsetToLineNumberAndPos(charOffset: number): ILineInfo;
    lineNumberToInfo(lineNumber: number): ILineInfo;
    print(): void;
    load(lines: string[]): void;
    walk(rangeStart: number, rangeLength: number, walkFns: ILineIndexWalker): void;
    getText(rangeStart: number, rangeLength: number): string;
    every(f: (ll: LineLeaf, s: number, len: number) => boolean, rangeStart: number, rangeEnd?: number): boolean;
    edit(pos: number, deleteLength: number, newText?: string): LineIndex;
    static buildTreeFromBottom(nodes: LineCollection[]): LineNode;
    static linesFromText(text: string): {
        lines: string[];
        lineMap: number[];
    };
}
export declare class LineNode implements LineCollection {
    totalChars: number;
    totalLines: number;
    children: LineCollection[];
    isLeaf(): boolean;
    print(indentAmt: number): void;
    updateCounts(): void;
    execWalk(rangeStart: number, rangeLength: number, walkFns: ILineIndexWalker, childIndex: number, nodeType: CharRangeSection): boolean;
    skipChild(relativeStart: number, relativeLength: number, childIndex: number, walkFns: ILineIndexWalker, nodeType: CharRangeSection): void;
    walk(rangeStart: number, rangeLength: number, walkFns: ILineIndexWalker): void;
    charOffsetToLineNumberAndPos(lineNumber: number, charOffset: number): ILineInfo;
    lineNumberToInfo(lineNumber: number, charOffset: number): ILineInfo;
    childFromLineNumber(lineNumber: number, charOffset: number): {
        child: LineCollection;
        childIndex: number;
        relativeLineNumber: number;
        charOffset: number;
    };
    childFromCharOffset(lineNumber: number, charOffset: number): {
        child: LineCollection;
        childIndex: number;
        charOffset: number;
        lineNumber: number;
    };
    splitAfter(childIndex: number): LineNode;
    remove(child: LineCollection): void;
    findChildIndex(child: LineCollection): number;
    insertAt(child: LineCollection, nodes: LineCollection[]): LineNode[];
    add(collection: LineCollection): boolean;
    charCount(): number;
    lineCount(): number;
}
export declare class LineLeaf implements LineCollection {
    text: string;
    udata: any;
    constructor(text: string);
    setUdata(data: any): void;
    getUdata(): any;
    isLeaf(): boolean;
    walk(rangeStart: number, rangeLength: number, walkFns: ILineIndexWalker): void;
    charCount(): number;
    lineCount(): number;
    print(indentAmt: number): void;
}
