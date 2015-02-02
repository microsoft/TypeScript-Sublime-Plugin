/// <reference path='../../node_modules/typescript/bin/typescript.d.ts'/>
/// <reference path='../../node_modules/typescript/bin/typescript_internal.d.ts'/>
/// <reference path='node.d.ts' />
var __extends = this.__extends || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    __.prototype = b.prototype;
    d.prototype = new __();
};
var ts = require('typescript');
var lineCollectionCapacity = 4;
var indentStrings = [];
var indentBase = "    ";
function getIndent(indentAmt) {
    if (!indentStrings[indentAmt]) {
        indentStrings[indentAmt] = "";
        for (var i = 0; i < indentAmt; i++) {
            indentStrings[indentAmt] += indentBase;
        }
    }
    return indentStrings[indentAmt];
}
function printLine(s) {
    ts.sys.write(s + '\n');
}
exports.printLine = printLine;
function showLines(s) {
    var strBuilder = "";
    for (var i = 0, len = s.length; i < len; i++) {
        if (s.charCodeAt(i) == 10) {
            strBuilder += '\\n';
        }
        else if (s.charCodeAt(i) == 13) {
            strBuilder += '\\r';
        }
        else {
            strBuilder += s.charAt(i);
        }
    }
    return strBuilder;
}
var ScriptInfo = (function () {
    function ScriptInfo(filename, content, isOpen) {
        if (isOpen === void 0) { isOpen = false; }
        this.filename = filename;
        this.content = content;
        this.isOpen = isOpen;
        this.isInferredRoot = false;
        this.activeProjects = []; // projects referencing this file
        this.children = []; // files referenced by this file
        this.svc = ScriptVersionCache.fromString(content);
    }
    ScriptInfo.prototype.addChild = function (childInfo) {
        this.children.push(childInfo);
    };
    ScriptInfo.prototype.snap = function () {
        return this.svc.getSnapshot();
    };
    ScriptInfo.prototype.getText = function () {
        var snap = this.snap();
        return snap.getText(0, snap.getLength());
    };
    ScriptInfo.prototype.getLineInfo = function (line) {
        var snap = this.snap();
        return snap.index.lineNumberToInfo(line);
    };
    ScriptInfo.prototype.editContent = function (minChar, limChar, newText) {
        this.svc.edit(minChar, limChar - minChar, newText);
    };
    ScriptInfo.prototype.getTextChangeRangeBetweenVersions = function (startVersion, endVersion) {
        return this.svc.getTextChangesBetweenVersions(startVersion, endVersion);
    };
    ScriptInfo.prototype.getChangeRange = function (oldSnapshot) {
        return this.snap().getChangeRange(oldSnapshot);
    };
    return ScriptInfo;
})();
exports.ScriptInfo = ScriptInfo;
var CancellationToken = (function () {
    function CancellationToken() {
        this.requestPending = false;
    }
    CancellationToken.prototype.cancel = function () {
        this.requestPending = true;
    };
    CancellationToken.prototype.reset = function () {
        this.requestPending = false;
    };
    CancellationToken.prototype.isCancellationRequested = function () {
        var temp = this.requestPending;
        return temp;
    };
    CancellationToken.None = new CancellationToken();
    return CancellationToken;
})();
exports.CancellationToken = CancellationToken;
// TODO: make this a parameter of the service or in service environment
var LSHost = (function () {
    function LSHost(cancellationToken) {
        if (cancellationToken === void 0) { cancellationToken = CancellationToken.None; }
        this.cancellationToken = cancellationToken;
        this.ls = null;
        this.filenameToScript = {};
        this.logger = this;
    }
    LSHost.prototype.trace = function (str) {
    };
    LSHost.prototype.error = function (str) {
    };
    LSHost.prototype.cancel = function () {
        this.cancellationToken.cancel();
    };
    LSHost.prototype.reset = function () {
        this.cancellationToken.reset();
    };
    LSHost.prototype.getScriptSnapshot = function (filename) {
        return this.getScriptInfo(filename).snap();
    };
    LSHost.prototype.setCompilationSettings = function (opt) {
        this.compilationSettings = opt;
    };
    LSHost.prototype.lineAffectsRefs = function (filename, line) {
        var info = this.getScriptInfo(filename);
        var lineInfo = info.getLineInfo(line);
        if (lineInfo && lineInfo.text) {
            var regex = /reference|import|\/\*|\*\//;
            return regex.test(lineInfo.text);
        }
    };
    LSHost.prototype.getCompilationSettings = function () {
        // change this to return active project settings for file
        return this.compilationSettings;
    };
    LSHost.prototype.getScriptFileNames = function () {
        var filenames = [];
        for (var filename in this.filenameToScript) {
            filenames.push(filename);
        }
        return filenames;
    };
    LSHost.prototype.getScriptVersion = function (filename) {
        return this.getScriptInfo(filename).svc.latestVersion().toString();
    };
    LSHost.prototype.getCancellationToken = function () {
        return this.cancellationToken;
    };
    LSHost.prototype.getCurrentDirectory = function () {
        return "";
    };
    LSHost.prototype.getDefaultLibFilename = function () {
        return "";
    };
    LSHost.prototype.getScriptIsOpen = function (filename) {
        return this.getScriptInfo(filename).isOpen;
    };
    LSHost.prototype.getScriptInfo = function (filename) {
        return ts.lookUp(this.filenameToScript, filename);
    };
    LSHost.prototype.addScriptInfo = function (info) {
        if (!this.getScriptInfo(info.filename)) {
            this.filenameToScript[info.filename] = info;
            return info;
        }
    };
    LSHost.prototype.saveTo = function (filename, tmpfilename) {
        var script = this.getScriptInfo(filename);
        if (script) {
            var snap = script.snap();
            ts.sys.writeFile(tmpfilename, snap.getText(0, snap.getLength()));
        }
    };
    LSHost.prototype.reloadScript = function (filename, tmpfilename, cb) {
        var script = this.getScriptInfo(filename);
        if (script) {
            script.svc.reloadFromFile(tmpfilename, cb);
        }
    };
    LSHost.prototype.editScript = function (filename, minChar, limChar, newText) {
        var script = this.getScriptInfo(filename);
        if (script) {
            script.editContent(minChar, limChar, newText);
            return;
        }
        throw new Error("No script with name '" + filename + "'");
    };
    LSHost.prototype.resolvePath = function (path) {
        var start = new Date().getTime();
        var result = ts.sys.resolvePath(path);
        return result;
    };
    LSHost.prototype.fileExists = function (path) {
        var start = new Date().getTime();
        var result = ts.sys.fileExists(path);
        return result;
    };
    LSHost.prototype.directoryExists = function (path) {
        return ts.sys.directoryExists(path);
    };
    LSHost.prototype.log = function (s) {
        // For debugging...
        //printLine("TypeScriptLS:" + s);
    };
    /**
     *  @param line 1 based index
     */
    LSHost.prototype.lineToTextSpan = function (filename, line) {
        var script = this.filenameToScript[filename];
        var index = script.snap().index;
        var lineInfo = index.lineNumberToInfo(line + 1);
        var len;
        if (lineInfo.leaf) {
            len = lineInfo.leaf.text.length;
        }
        else {
            var nextLineInfo = index.lineNumberToInfo(line + 2);
            len = nextLineInfo.offset - lineInfo.offset;
        }
        return ts.createTextSpan(lineInfo.offset, len);
    };
    /**
     * @param line 1 based index
     * @param col 1 based index
     */
    LSHost.prototype.lineColToPosition = function (filename, line, col) {
        var script = this.filenameToScript[filename];
        var index = script.snap().index;
        var lineInfo = index.lineNumberToInfo(line);
        // TODO: assert this column is actually on the line
        return (lineInfo.offset + col - 1);
    };
    /**
     * @param line 0 based index
     * @param offset 0 based index
     */
    LSHost.prototype.positionToZeroBasedLineCol = function (filename, position) {
        var script = this.filenameToScript[filename];
        var index = script.snap().index;
        var lineCol = index.charOffsetToLineNumberAndPos(position);
        return { line: lineCol.line - 1, offset: lineCol.offset };
    };
    return LSHost;
})();
exports.LSHost = LSHost;
function getCanonicalFileName(filename) {
    if (ts.sys.useCaseSensitiveFileNames) {
        return filename;
    }
    else {
        return filename.toLowerCase();
    }
}
// assumes normalized paths
function getAbsolutePath(filename, directory) {
    var rootLength = ts.getRootLength(filename);
    if (rootLength > 0) {
        return filename;
    }
    else {
        var splitFilename = filename.split('/');
        var splitDir = directory.split('/');
        var i = 0;
        var dirTail = 0;
        var sflen = splitFilename.length;
        while ((i < sflen) && (splitFilename[i].charAt(0) == '.')) {
            var dots = splitFilename[i];
            if (dots == '..') {
                dirTail++;
            }
            else if (dots != '.') {
                return undefined;
            }
            i++;
        }
        return splitDir.slice(0, splitDir.length - dirTail).concat(splitFilename.slice(i)).join('/');
    }
}
var Project = (function () {
    function Project() {
        this.compilerService = new CompilerService();
    }
    Project.prototype.graphFinished = function () {
        this.compilerService.languageService.getNavigateToItems(".*");
    };
    Project.prototype.addGraph = function (scriptInfo) {
        if (this.addScript(scriptInfo)) {
            for (var i = 0, clen = scriptInfo.children.length; i < clen; i++) {
                this.addGraph(scriptInfo.children[i]);
            }
        }
    };
    Project.prototype.isConfiguredProject = function () {
        return this.projectFilename;
    };
    Project.prototype.addScript = function (info) {
        if ((!info.defaultProject) || (!info.defaultProject.isConfiguredProject())) {
            info.defaultProject = this;
        }
        info.activeProjects.push(this);
        return this.compilerService.host.addScriptInfo(info);
    };
    Project.prototype.printFiles = function () {
        var filenames = this.compilerService.host.getScriptFileNames();
        filenames.map(function (filename) {
            console.log(filename);
        });
    };
    Project.prototype.setProjectOptions = function (projectOptions) {
        this.projectOptions = projectOptions;
        if (projectOptions.compilerOptions) {
            this.compilerService.setCompilerOptions(projectOptions.compilerOptions);
        }
        if (projectOptions.formatCodeOptions) {
            this.compilerService.setFormatCodeOptions(projectOptions.formatCodeOptions);
        }
    };
    Project.createProject = function (projectFilename) {
        var eproj = new Project();
        eproj.projectFilename = projectFilename;
        return eproj;
    };
    Project.createInferredProject = function (root) {
        var iproj = new Project();
        iproj.addGraph(root);
        iproj.graphFinished();
        return iproj;
    };
    return Project;
})();
exports.Project = Project;
// TODO: keep set of open, non-configured files (changes on open/close and
// also may change if tsconfig contents change to configure one of the
// files
// upon open of new file f, check if member of existing inferred project
// if not, create new inferred project with f as root
// upon close of file, or change to references in any file, re-compute
// projects for files, by the following:
// let o be set of open, non-configured files
// for ip in inferredProjects 
//   let prog=ip.get program
//   mark all files in o that are also in prog; if none, delete ip
// for f in o
//   if f unmarked 
//     create new inferred project ipn
//     mark members of i covered by ipn
// to find inferred projects containing f, use cached prog
// for ip in inferredProjects
//    if f in cached prog for up, f in ip
// this is only used for find references
// for other ls calls, use most recently created proj referencing f
// (cache this or recompute based on mru order)
// keep opened files in mru order
var ProjectService = (function () {
    function ProjectService() {
        this.filenameToScriptInfo = {};
        this.inferredRoots = [];
        this.inferredProjects = [];
        this.inferredRootsChanged = false;
        this.newRootDisjoint = true;
    }
    ProjectService.prototype.addDefaultLibraryToProject = function (proj) {
        var nodeModuleBinDir;
        var defaultLib;
        if (proj.projectOptions && proj.projectOptions.compilerOptions && (proj.projectOptions.compilerOptions.target == 2 /* ES6 */)) {
            if (!this.defaultES6LibInfo) {
                nodeModuleBinDir = ts.getDirectoryPath(ts.normalizePath(ts.sys.getExecutingFilePath()));
                defaultLib = nodeModuleBinDir + "/lib.es6.d.ts";
                this.defaultES6LibInfo = this.openFile(defaultLib);
            }
            proj.addScript(this.defaultES6LibInfo);
        }
        else {
            if (!this.defaultLibInfo) {
                nodeModuleBinDir = ts.getDirectoryPath(ts.normalizePath(ts.sys.getExecutingFilePath()));
                defaultLib = nodeModuleBinDir + "/lib.d.ts";
                this.defaultLibInfo = this.openFile(defaultLib);
            }
            proj.addScript(this.defaultLibInfo);
        }
    };
    ProjectService.prototype.getProjectForFile = function (filename) {
        var scriptInfo = ts.lookUp(this.filenameToScriptInfo, filename);
        if (!scriptInfo) {
            scriptInfo = this.openSpecifiedFile(filename, false, false);
        }
        // TODO: error upon file not found
        return scriptInfo.defaultProject;
    };
    ProjectService.prototype.printProjectsForFile = function (filename) {
        var scriptInfo = ts.lookUp(this.filenameToScriptInfo, filename);
        if (scriptInfo) {
            console.log("Projects for " + filename);
            for (var i = 0, len = scriptInfo.activeProjects.length; i < len; i++) {
                for (var j = 0, iplen = this.inferredProjects.length; j < iplen; j++) {
                    if (scriptInfo.activeProjects[i] == this.inferredProjects[j]) {
                        console.log("Inferred Project " + j.toString());
                    }
                }
            }
        }
        else {
            console.log(filename + " not in any project");
        }
    };
    ProjectService.prototype.printProjects = function () {
        for (var i = 0, len = this.inferredProjects.length; i < len; i++) {
            var project = this.inferredProjects[i];
            console.log("Project " + i.toString());
            project.printFiles();
            console.log("-----------------------------------------------");
        }
    };
    ProjectService.prototype.removeInferredRoot = function (info) {
        var len = this.inferredRoots.length;
        for (var i = 0; i < len; i++) {
            if (this.inferredRoots[i] == info) {
                if (i < (len - 1)) {
                    this.inferredRoots[i] = this.inferredRoots[len - 1];
                }
                this.inferredRoots.length--;
                this.inferredRootsChanged = true;
                info.isInferredRoot = false;
                return true;
            }
        }
        return false;
    };
    ProjectService.prototype.openConfigFile = function (configFilename) {
        configFilename = ts.normalizePath(configFilename);
        // file references will be relative to dirPath (or absolute)
        var dirPath = ts.getDirectoryPath(configFilename);
        var rawConfig = ts.readConfigFile(configFilename);
        if (!rawConfig) {
            return { errorMsg: "tsconfig syntax error" };
        }
        else {
            // REVIEW: specify no base path so can get absolute path below
            var parsedCommandLine = ts.parseConfigFile(rawConfig);
            if (parsedCommandLine.errors) {
                // TODO: gather diagnostics and transmit
                return { errorMsg: "tsconfig option errors" };
            }
            else if (parsedCommandLine.filenames) {
                var proj = Project.createProject(configFilename);
                for (var i = 0, len = parsedCommandLine.filenames.length; i < len; i++) {
                    var rootFilename = parsedCommandLine.filenames[i];
                    var normRootFilename = ts.normalizePath(rootFilename);
                    normRootFilename = getAbsolutePath(normRootFilename, dirPath);
                    if (ts.sys.fileExists(normRootFilename)) {
                        var info = this.openSpecifiedFile(normRootFilename, false, true);
                        proj.addGraph(info);
                    }
                    else {
                        return { errorMsg: "specified file " + rootFilename + " not found" };
                    }
                }
                var projectOptions = {
                    files: parsedCommandLine.filenames,
                    compilerOptions: parsedCommandLine.options
                };
                if (rawConfig.formatCodeOptions) {
                    projectOptions.formatCodeOptions = rawConfig.formatCodeOptions;
                }
                proj.setProjectOptions(projectOptions);
                this.addDefaultLibraryToProject(proj);
                return { success: true, project: proj };
            }
            else {
                return { errorMsg: "no files found" };
            }
        }
    };
    ProjectService.prototype.openSpecifiedFile = function (filename, openedByClient, configuredProject) {
        if (openedByClient === void 0) { openedByClient = true; }
        if (configuredProject === void 0) { configuredProject = false; }
        this.inferredRootsChanged = false;
        this.newRootDisjoint = true;
        var info = this.openFile(filename, openedByClient, configuredProject);
        if (this.inferredRootsChanged) {
            var i = 0;
            var len = this.inferredRoots.length;
            if (this.newRootDisjoint) {
                i = len - 1;
            }
            // TODO: when destroying projects, remove refs from ScriptInfos
            for (; i < len; i++) {
                var root = this.inferredRoots[i];
                root.isInferredRoot = true;
                this.inferredProjects[i] = Project.createInferredProject(root);
                this.addDefaultLibraryToProject(this.inferredProjects[i]);
            }
        }
        return info;
    };
    ProjectService.prototype.recomputeReferences = function (filename) {
        var info = ts.lookUp(this.filenameToScriptInfo, filename);
        if (info) {
            var prevChildrenList = info.children;
            var prevChildren = {};
            var orphans = [];
            var adopted = [];
            for (var i = 0, len = prevChildrenList.length; i < len; i++) {
                prevChildren[prevChildrenList[i].filename] = true;
            }
            info.children = [];
            var dirPath = ts.getDirectoryPath(filename);
            this.computeReferences(info, dirPath);
            var children = {};
            for (var j = 0, clen = info.children.length; j < clen; j++) {
                children[info.children[j].filename] = true;
                if (!prevChildren[info.children[j].filename]) {
                    adopted.push(info.children[j]);
                }
            }
            for (i = 0; i < len; i++) {
                if (!children[prevChildrenList[i].filename]) {
                    orphans.push(prevChildrenList[i]);
                }
            }
        }
    };
    ProjectService.prototype.computeReferences = function (info, dirPath, content) {
        if (!content) {
            content = info.getText();
        }
        var preProcessedInfo = ts.preProcessFile(content, false);
        // TODO: add import references
        if (preProcessedInfo.referencedFiles.length > 0) {
            for (var i = 0, len = preProcessedInfo.referencedFiles.length; i < len; i++) {
                var refFilename = ts.normalizePath(preProcessedInfo.referencedFiles[i].filename);
                refFilename = getAbsolutePath(refFilename, dirPath);
                var refInfo = this.openFile(refFilename);
                info.addChild(refInfo);
            }
        }
    };
    /**
     * @param filename is absolute pathname
     */
    ProjectService.prototype.openFile = function (filename, openedByClient, configuredProject) {
        if (openedByClient === void 0) { openedByClient = false; }
        if (configuredProject === void 0) { configuredProject = false; }
        //console.log("opening "+filename+"...");
        filename = ts.normalizePath(filename);
        var dirPath = ts.getDirectoryPath(filename);
        //console.log("normalized as "+filename+" with dir path "+dirPath);
        var info = ts.lookUp(this.filenameToScriptInfo, filename);
        if (!info) {
            var content = "";
            if (ts.sys.fileExists(filename)) {
                content = ts.sys.readFile(filename);
            }
            info = new ScriptInfo(filename, content, openedByClient);
            this.filenameToScriptInfo[filename] = info;
            if (openedByClient && (!configuredProject)) {
                // this is a root because newly opened due to a client request
                // it would already be open if an existing inferred project referenced it
                this.inferredRoots.push(info);
                this.inferredRootsChanged = true;
            }
            if (content.length > 0) {
                this.computeReferences(info, dirPath, content);
            }
        }
        else if (info.isInferredRoot && (!openedByClient)) {
            if (this.removeInferredRoot(info)) {
                this.inferredRootsChanged = true;
                this.newRootDisjoint = false;
            }
        }
        return info;
    };
    return ProjectService;
})();
exports.ProjectService = ProjectService;
var CompilerService = (function () {
    function CompilerService() {
        this.cancellationToken = new CancellationToken();
        this.host = new LSHost(this.cancellationToken);
        this.settings = ts.getDefaultCompilerOptions();
        this.documentRegistry = ts.createDocumentRegistry();
        this.formatCodeOptions = CompilerService.defaultFormatCodeOptions;
        this.host.setCompilationSettings(ts.getDefaultCompilerOptions());
        this.languageService = ts.createLanguageService(this.host, this.documentRegistry);
        this.classifier = ts.createClassifier(this.host);
    }
    CompilerService.prototype.setCompilerOptions = function (opt) {
        this.host.setCompilationSettings(opt);
    };
    CompilerService.prototype.setFormatCodeOptions = function (fco) {
        // use this loop to preserve default values
        for (var p in fco) {
            if (fco.hasOwnProperty(p)) {
                this.formatCodeOptions[p] = fco[p];
            }
        }
    };
    CompilerService.prototype.isExternalModule = function (filename) {
        var sourceFile = this.languageService.getSourceFile(filename);
        return ts.isExternalModule(sourceFile);
    };
    CompilerService.defaultFormatCodeOptions = {
        IndentSize: 4,
        TabSize: 4,
        NewLineCharacter: ts.sys.newLine,
        ConvertTabsToSpaces: true,
        InsertSpaceAfterCommaDelimiter: true,
        InsertSpaceAfterSemicolonInForStatements: true,
        InsertSpaceBeforeAndAfterBinaryOperators: true,
        InsertSpaceAfterKeywordsInControlFlowStatements: true,
        InsertSpaceAfterFunctionKeywordForAnonymousFunctions: false,
        InsertSpaceAfterOpeningAndBeforeClosingNonemptyParenthesis: false,
        PlaceOpenBraceOnNewLineForFunctions: false,
        PlaceOpenBraceOnNewLineForControlBlocks: false
    };
    return CompilerService;
})();
exports.CompilerService = CompilerService;
(function (CharRangeSection) {
    CharRangeSection[CharRangeSection["PreStart"] = 0] = "PreStart";
    CharRangeSection[CharRangeSection["Start"] = 1] = "Start";
    CharRangeSection[CharRangeSection["Entire"] = 2] = "Entire";
    CharRangeSection[CharRangeSection["Mid"] = 3] = "Mid";
    CharRangeSection[CharRangeSection["End"] = 4] = "End";
    CharRangeSection[CharRangeSection["PostEnd"] = 5] = "PostEnd";
})(exports.CharRangeSection || (exports.CharRangeSection = {}));
var CharRangeSection = exports.CharRangeSection;
var BaseLineIndexWalker = (function () {
    function BaseLineIndexWalker() {
        this.goSubtree = true;
        this.done = false;
    }
    BaseLineIndexWalker.prototype.leaf = function (rangeStart, rangeLength, ll) {
    };
    return BaseLineIndexWalker;
})();
var EditWalker = (function (_super) {
    __extends(EditWalker, _super);
    function EditWalker() {
        _super.call(this);
        this.lineIndex = new LineIndex();
        this.endBranch = [];
        this.state = 2 /* Entire */;
        this.initialText = "";
        this.trailingText = "";
        this.suppressTrailingText = false;
        this.lineIndex.root = new LineNode();
        this.startPath = [this.lineIndex.root];
        this.stack = [this.lineIndex.root];
    }
    EditWalker.prototype.insertLines = function (insertedText) {
        if (this.suppressTrailingText) {
            this.trailingText = "";
        }
        if (insertedText) {
            insertedText = this.initialText + insertedText + this.trailingText;
        }
        else {
            insertedText = this.initialText + this.trailingText;
        }
        var lm = LineIndex.linesFromText(insertedText);
        var lines = lm.lines;
        if (lines.length > 1) {
            if (lines[lines.length - 1] == "") {
                lines.length--;
            }
        }
        var branchParent;
        var lastZeroCount;
        for (var k = this.endBranch.length - 1; k >= 0; k--) {
            this.endBranch[k].updateCounts();
            if (this.endBranch[k].charCount() == 0) {
                lastZeroCount = this.endBranch[k];
                if (k > 0) {
                    branchParent = this.endBranch[k - 1];
                }
                else {
                    branchParent = this.branchNode;
                }
            }
        }
        if (lastZeroCount) {
            branchParent.remove(lastZeroCount);
        }
        // path at least length two (root and leaf)
        var insertionNode = this.startPath[this.startPath.length - 2];
        var leafNode = this.startPath[this.startPath.length - 1];
        var len = lines.length;
        if (len > 0) {
            leafNode.text = lines[0];
            if (len > 1) {
                var insertedNodes = new Array(len - 1);
                var startNode = leafNode;
                for (var i = 1, len = lines.length; i < len; i++) {
                    insertedNodes[i - 1] = new LineLeaf(lines[i]);
                }
                var pathIndex = this.startPath.length - 2;
                while (pathIndex >= 0) {
                    insertionNode = this.startPath[pathIndex];
                    insertedNodes = insertionNode.insertAt(startNode, insertedNodes);
                    pathIndex--;
                    startNode = insertionNode;
                }
                var insertedNodesLen = insertedNodes.length;
                while (insertedNodesLen > 0) {
                    var newRoot = new LineNode();
                    newRoot.add(this.lineIndex.root);
                    insertedNodes = newRoot.insertAt(this.lineIndex.root, insertedNodes);
                    insertedNodesLen = insertedNodes.length;
                    this.lineIndex.root = newRoot;
                }
                this.lineIndex.root.updateCounts();
            }
            else {
                for (var j = this.startPath.length - 2; j >= 0; j--) {
                    this.startPath[j].updateCounts();
                }
            }
        }
        else {
            // no content for leaf node, so delete it
            insertionNode.remove(leafNode);
            for (var j = this.startPath.length - 2; j >= 0; j--) {
                this.startPath[j].updateCounts();
            }
        }
        return this.lineIndex;
    };
    EditWalker.prototype.post = function (relativeStart, relativeLength, lineCollection, parent, nodeType) {
        // have visited the path for start of range, now looking for end
        // if range is on single line, we will never make this state transition
        if (lineCollection == this.lineCollectionAtBranch) {
            this.state = 4 /* End */;
        }
        // always pop stack because post only called when child has been visited
        this.stack.length--;
        return undefined;
    };
    EditWalker.prototype.pre = function (relativeStart, relativeLength, lineCollection, parent, nodeType) {
        // currentNode corresponds to parent, but in the new tree
        var currentNode = this.stack[this.stack.length - 1];
        if ((this.state == 2 /* Entire */) && (nodeType == 1 /* Start */)) {
            // if range is on single line, we will never make this state transition
            this.state = 1 /* Start */;
            this.branchNode = currentNode;
            this.lineCollectionAtBranch = lineCollection;
        }
        var child;
        function fresh(node) {
            if (node.isLeaf()) {
                return new LineLeaf("");
            }
            else
                return new LineNode();
        }
        switch (nodeType) {
            case 0 /* PreStart */:
                this.goSubtree = false;
                if (this.state != 4 /* End */) {
                    currentNode.add(lineCollection);
                }
                break;
            case 1 /* Start */:
                if (this.state == 4 /* End */) {
                    this.goSubtree = false;
                }
                else {
                    child = fresh(lineCollection);
                    currentNode.add(child);
                    this.startPath[this.startPath.length] = child;
                }
                break;
            case 2 /* Entire */:
                if (this.state != 4 /* End */) {
                    child = fresh(lineCollection);
                    currentNode.add(child);
                    this.startPath[this.startPath.length] = child;
                }
                else {
                    if (!lineCollection.isLeaf()) {
                        child = fresh(lineCollection);
                        currentNode.add(child);
                        this.endBranch[this.endBranch.length] = child;
                    }
                }
                break;
            case 3 /* Mid */:
                this.goSubtree = false;
                break;
            case 4 /* End */:
                if (this.state != 4 /* End */) {
                    this.goSubtree = false;
                }
                else {
                    if (!lineCollection.isLeaf()) {
                        child = fresh(lineCollection);
                        currentNode.add(child);
                        this.endBranch[this.endBranch.length] = child;
                    }
                }
                break;
            case 5 /* PostEnd */:
                this.goSubtree = false;
                if (this.state != 1 /* Start */) {
                    currentNode.add(lineCollection);
                }
                break;
        }
        if (this.goSubtree) {
            this.stack[this.stack.length] = child;
        }
        return lineCollection;
    };
    // just gather text from the leaves
    EditWalker.prototype.leaf = function (relativeStart, relativeLength, ll) {
        if (this.state == 1 /* Start */) {
            this.initialText = ll.text.substring(0, relativeStart);
        }
        else if (this.state == 2 /* Entire */) {
            this.initialText = ll.text.substring(0, relativeStart);
            this.trailingText = ll.text.substring(relativeStart + relativeLength);
        }
        else {
            // state is CharRangeSection.End
            this.trailingText = ll.text.substring(relativeStart + relativeLength);
        }
    };
    return EditWalker;
})(BaseLineIndexWalker);
// text change information 
var TextChange = (function () {
    function TextChange(pos, deleteLen, insertedText) {
        this.pos = pos;
        this.deleteLen = deleteLen;
        this.insertedText = insertedText;
    }
    TextChange.prototype.getTextChangeRange = function () {
        return ts.createTextChangeRange(ts.createTextSpan(this.pos, this.deleteLen), this.insertedText ? this.insertedText.length : 0);
    };
    return TextChange;
})();
exports.TextChange = TextChange;
var ScriptVersionCache = (function () {
    function ScriptVersionCache() {
        this.changes = [];
        this.versions = [];
        this.minVersion = 0; // no versions earlier than min version will maintain change history
        this.currentVersion = 0;
    }
    // REVIEW: can optimize by coalescing simple edits
    ScriptVersionCache.prototype.edit = function (pos, deleteLen, insertedText) {
        this.changes[this.changes.length] = new TextChange(pos, deleteLen, insertedText);
        if ((this.changes.length > ScriptVersionCache.changeNumberThreshold) || (deleteLen > ScriptVersionCache.changeLengthThreshold) || (insertedText && (insertedText.length > ScriptVersionCache.changeLengthThreshold))) {
            this.getSnapshot();
        }
    };
    ScriptVersionCache.prototype.latest = function () {
        return this.versions[this.currentVersion];
    };
    ScriptVersionCache.prototype.latestVersion = function () {
        if (this.changes.length > 0) {
            this.getSnapshot();
        }
        return this.currentVersion;
    };
    ScriptVersionCache.prototype.reloadFromFile = function (filename, cb) {
        var content = ts.sys.readFile(filename);
        this.reload(content);
        if (cb)
            cb();
    };
    // reload whole script, leaving no change history behind reload
    ScriptVersionCache.prototype.reload = function (script) {
        this.currentVersion++;
        this.changes = []; // history wiped out by reload
        var snap = new LineIndexSnapshot(this.currentVersion, this);
        this.versions[this.currentVersion] = snap;
        snap.index = new LineIndex();
        var lm = LineIndex.linesFromText(script);
        snap.index.load(lm.lines);
        // REVIEW: could use linked list 
        for (var i = this.minVersion; i < this.currentVersion; i++) {
            this.versions[i] = undefined;
        }
        this.minVersion = this.currentVersion;
    };
    ScriptVersionCache.prototype.getSnapshot = function () {
        var snap = this.versions[this.currentVersion];
        if (this.changes.length > 0) {
            var snapIndex = this.latest().index;
            for (var i = 0, len = this.changes.length; i < len; i++) {
                var change = this.changes[i];
                snapIndex = snapIndex.edit(change.pos, change.deleteLen, change.insertedText);
            }
            snap = new LineIndexSnapshot(this.currentVersion + 1, this);
            snap.index = snapIndex;
            snap.changesSincePreviousVersion = this.changes;
            this.currentVersion = snap.version;
            this.versions[snap.version] = snap;
            this.changes = [];
        }
        return snap;
    };
    ScriptVersionCache.prototype.getTextChangesBetweenVersions = function (oldVersion, newVersion) {
        if (oldVersion < newVersion) {
            if (oldVersion >= this.minVersion) {
                var textChangeRanges = [];
                for (var i = oldVersion + 1; i <= newVersion; i++) {
                    var snap = this.versions[i];
                    for (var j = 0, len = snap.changesSincePreviousVersion.length; j < len; j++) {
                        var textChange = snap.changesSincePreviousVersion[j];
                        textChangeRanges[textChangeRanges.length] = textChange.getTextChangeRange();
                    }
                }
                return ts.collapseTextChangeRangesAcrossMultipleVersions(textChangeRanges);
            }
            else {
                return undefined;
            }
        }
        else {
            return ts.unchangedTextChangeRange;
        }
    };
    ScriptVersionCache.fromString = function (script) {
        var svc = new ScriptVersionCache();
        var snap = new LineIndexSnapshot(0, svc);
        svc.versions[svc.currentVersion] = snap;
        snap.index = new LineIndex();
        var lm = LineIndex.linesFromText(script);
        snap.index.load(lm.lines);
        return svc;
    };
    ScriptVersionCache.changeNumberThreshold = 8;
    ScriptVersionCache.changeLengthThreshold = 256;
    return ScriptVersionCache;
})();
exports.ScriptVersionCache = ScriptVersionCache;
var LineIndexSnapshot = (function () {
    function LineIndexSnapshot(version, cache) {
        this.version = version;
        this.cache = cache;
        this.changesSincePreviousVersion = [];
    }
    LineIndexSnapshot.prototype.getText = function (rangeStart, rangeEnd) {
        return this.index.getText(rangeStart, rangeEnd - rangeStart);
    };
    LineIndexSnapshot.prototype.getLength = function () {
        return this.index.root.charCount();
    };
    // this requires linear space so don't hold on to these 
    LineIndexSnapshot.prototype.getLineStartPositions = function () {
        var starts = [-1];
        var count = 1;
        var pos = 0;
        this.index.every(function (ll, s, len) {
            starts[count++] = pos;
            pos += ll.text.length;
            return true;
        }, 0);
        return starts;
    };
    LineIndexSnapshot.prototype.getLineMapper = function () {
        var _this = this;
        return (function (line) {
            return _this.index.lineNumberToInfo(line).offset;
        });
    };
    LineIndexSnapshot.prototype.getTextChangeRangeSinceVersion = function (scriptVersion) {
        if (this.version <= scriptVersion) {
            return ts.unchangedTextChangeRange;
        }
        else {
            return this.cache.getTextChangesBetweenVersions(scriptVersion, this.version);
        }
    };
    LineIndexSnapshot.prototype.getChangeRange = function (oldSnapshot) {
        var oldSnap = oldSnapshot;
        return this.getTextChangeRangeSinceVersion(oldSnap.version);
    };
    return LineIndexSnapshot;
})();
exports.LineIndexSnapshot = LineIndexSnapshot;
var LineIndex = (function () {
    function LineIndex() {
        // set this to true to check each edit for accuracy
        this.checkEdits = false;
    }
    LineIndex.prototype.charOffsetToLineNumberAndPos = function (charOffset) {
        return this.root.charOffsetToLineNumberAndPos(1, charOffset);
    };
    LineIndex.prototype.lineNumberToInfo = function (lineNumber) {
        var lineCount = this.root.lineCount();
        if (lineNumber <= lineCount) {
            var lineInfo = this.root.lineNumberToInfo(lineNumber, 0);
            lineInfo.line = lineNumber;
            return lineInfo;
        }
        else {
            return {
                line: lineNumber,
                offset: this.root.charCount()
            };
        }
    };
    LineIndex.prototype.print = function () {
        printLine("index TC " + this.root.charCount() + " TL " + this.root.lineCount());
        this.root.print(0);
        printLine("");
    };
    LineIndex.prototype.load = function (lines) {
        if (lines.length > 0) {
            var leaves = [];
            for (var i = 0, len = lines.length; i < len; i++) {
                leaves[i] = new LineLeaf(lines[i]);
            }
            this.root = LineIndex.buildTreeFromBottom(leaves);
        }
        else {
            this.root = new LineNode();
        }
    };
    LineIndex.prototype.walk = function (rangeStart, rangeLength, walkFns) {
        this.root.walk(rangeStart, rangeLength, walkFns);
    };
    LineIndex.prototype.getText = function (rangeStart, rangeLength) {
        var accum = "";
        if (rangeLength > 0) {
            this.walk(rangeStart, rangeLength, {
                goSubtree: true,
                done: false,
                leaf: function (relativeStart, relativeLength, ll) {
                    accum = accum.concat(ll.text.substring(relativeStart, relativeStart + relativeLength));
                }
            });
        }
        return accum;
    };
    LineIndex.prototype.every = function (f, rangeStart, rangeEnd) {
        if (!rangeEnd) {
            rangeEnd = this.root.charCount();
        }
        var walkFns = {
            goSubtree: true,
            done: false,
            leaf: function (relativeStart, relativeLength, ll) {
                if (!f(ll, relativeStart, relativeLength)) {
                    this.done = true;
                }
            }
        };
        this.walk(rangeStart, rangeEnd - rangeStart, walkFns);
        return !walkFns.done;
    };
    LineIndex.prototype.edit = function (pos, deleteLength, newText) {
        function editFlat(source, s, dl, nt) {
            if (nt === void 0) { nt = ""; }
            return source.substring(0, s) + nt + source.substring(s + dl, source.length);
        }
        if (this.root.charCount() == 0) {
            // TODO: assert deleteLength == 0
            if (newText) {
                this.load(LineIndex.linesFromText(newText).lines);
                return this;
            }
        }
        else {
            if (this.checkEdits) {
                var checkText = editFlat(this.getText(0, this.root.charCount()), pos, deleteLength, newText);
            }
            var walker = new EditWalker();
            if (deleteLength > 0) {
                // check whether last characters deleted are line break
                var e = pos + deleteLength;
                var lineInfo = this.charOffsetToLineNumberAndPos(e);
                if ((lineInfo && (lineInfo.offset == 0))) {
                    // move range end just past line that will merge with previous line
                    deleteLength += lineInfo.text.length;
                    // store text by appending to end of insertedText
                    if (newText) {
                        newText = newText + lineInfo.text;
                    }
                    else {
                        newText = lineInfo.text;
                    }
                }
            }
            else if (pos >= this.root.charCount()) {
                // insert at end
                var endString = this.getText(pos - 1, 1);
                if (newText) {
                    newText = endString + newText;
                }
                else {
                    newText = endString;
                }
                pos = pos - 1;
                deleteLength = 0;
                walker.suppressTrailingText = true;
            }
            this.root.walk(pos, deleteLength, walker);
            walker.insertLines(newText);
            if (this.checkEdits) {
                var updatedText = this.getText(0, this.root.charCount());
                if (checkText != updatedText) {
                    console.log("buffer edit mismatch");
                }
            }
            return walker.lineIndex;
        }
    };
    LineIndex.buildTreeFromBottom = function (nodes) {
        var nodeCount = Math.ceil(nodes.length / lineCollectionCapacity);
        var interiorNodes = [];
        var nodeIndex = 0;
        for (var i = 0; i < nodeCount; i++) {
            interiorNodes[i] = new LineNode();
            var charCount = 0;
            var lineCount = 0;
            for (var j = 0; j < lineCollectionCapacity; j++) {
                if (nodeIndex < nodes.length) {
                    interiorNodes[i].add(nodes[nodeIndex]);
                    charCount += nodes[nodeIndex].charCount();
                    lineCount += nodes[nodeIndex].lineCount();
                }
                else {
                    break;
                }
                nodeIndex++;
            }
            interiorNodes[i].totalChars = charCount;
            interiorNodes[i].totalLines = lineCount;
        }
        if (interiorNodes.length == 1) {
            return interiorNodes[0];
        }
        else {
            return this.buildTreeFromBottom(interiorNodes);
        }
    };
    LineIndex.linesFromText = function (text) {
        var sourceSnap = ts.ScriptSnapshot.fromString(text);
        var lineStarts = sourceSnap.getLineStartPositions();
        if (lineStarts.length == 0) {
            return { lines: [], lineMap: lineStarts };
        }
        var lines = new Array(lineStarts.length);
        var lc = lineStarts.length - 1;
        for (var lmi = 0; lmi < lc; lmi++) {
            lines[lmi] = text.substring(lineStarts[lmi], lineStarts[lmi + 1]);
        }
        var endText = text.substring(lineStarts[lc]);
        if (endText.length > 0) {
            lines[lc] = endText;
        }
        else {
            lines.length--;
        }
        return { lines: lines, lineMap: lineStarts };
    };
    return LineIndex;
})();
exports.LineIndex = LineIndex;
var LineNode = (function () {
    function LineNode() {
        this.totalChars = 0;
        this.totalLines = 0;
        this.children = [];
    }
    LineNode.prototype.isLeaf = function () {
        return false;
    };
    LineNode.prototype.print = function (indentAmt) {
        var strBuilder = getIndent(indentAmt);
        strBuilder += ("node ch " + this.children.length + " TC " + this.totalChars + " TL " + this.totalLines + " :");
        printLine(strBuilder);
        for (var ch = 0, clen = this.children.length; ch < clen; ch++) {
            this.children[ch].print(indentAmt + 1);
        }
    };
    LineNode.prototype.updateCounts = function () {
        this.totalChars = 0;
        this.totalLines = 0;
        for (var i = 0, len = this.children.length; i < len; i++) {
            var child = this.children[i];
            this.totalChars += child.charCount();
            this.totalLines += child.lineCount();
        }
    };
    LineNode.prototype.execWalk = function (rangeStart, rangeLength, walkFns, childIndex, nodeType) {
        if (walkFns.pre) {
            walkFns.pre(rangeStart, rangeLength, this.children[childIndex], this, nodeType);
        }
        if (walkFns.goSubtree) {
            this.children[childIndex].walk(rangeStart, rangeLength, walkFns);
            if (walkFns.post) {
                walkFns.post(rangeStart, rangeLength, this.children[childIndex], this, nodeType);
            }
        }
        else {
            walkFns.goSubtree = true;
        }
        return walkFns.done;
    };
    LineNode.prototype.skipChild = function (relativeStart, relativeLength, childIndex, walkFns, nodeType) {
        if (walkFns.pre && (!walkFns.done)) {
            walkFns.pre(relativeStart, relativeLength, this.children[childIndex], this, nodeType);
            walkFns.goSubtree = true;
        }
    };
    LineNode.prototype.walk = function (rangeStart, rangeLength, walkFns) {
        // assume (rangeStart < this.totalChars) && (rangeLength <= this.totalChars) 
        var childIndex = 0;
        var child = this.children[0];
        var childCharCount = child.charCount();
        // find sub-tree containing start
        var adjustedStart = rangeStart;
        while (adjustedStart >= childCharCount) {
            this.skipChild(adjustedStart, rangeLength, childIndex, walkFns, 0 /* PreStart */);
            adjustedStart -= childCharCount;
            child = this.children[++childIndex];
            childCharCount = child.charCount();
        }
        // Case I: both start and end of range in same subtree
        if ((adjustedStart + rangeLength) <= childCharCount) {
            if (this.execWalk(adjustedStart, rangeLength, walkFns, childIndex, 2 /* Entire */)) {
                return;
            }
        }
        else {
            // Case II: start and end of range in different subtrees (possibly with subtrees in the middle)
            if (this.execWalk(adjustedStart, childCharCount - adjustedStart, walkFns, childIndex, 1 /* Start */)) {
                return;
            }
            var adjustedLength = rangeLength - (childCharCount - adjustedStart);
            child = this.children[++childIndex];
            if (!child) {
                this.print(2);
            }
            childCharCount = child.charCount();
            while (adjustedLength > childCharCount) {
                if (this.execWalk(0, childCharCount, walkFns, childIndex, 3 /* Mid */)) {
                    return;
                }
                adjustedLength -= childCharCount;
                child = this.children[++childIndex];
                childCharCount = child.charCount();
            }
            if (adjustedLength > 0) {
                if (this.execWalk(0, adjustedLength, walkFns, childIndex, 4 /* End */)) {
                    return;
                }
            }
        }
        // Process any subtrees after the one containing range end
        if (walkFns.pre) {
            var clen = this.children.length;
            if (childIndex < (clen - 1)) {
                for (var ej = childIndex + 1; ej < clen; ej++) {
                    this.skipChild(0, 0, ej, walkFns, 5 /* PostEnd */);
                }
            }
        }
    };
    LineNode.prototype.charOffsetToLineNumberAndPos = function (lineNumber, charOffset) {
        var childInfo = this.childFromCharOffset(lineNumber, charOffset);
        if (childInfo.childIndex < this.children.length) {
            if (childInfo.child.isLeaf()) {
                return {
                    line: childInfo.lineNumber,
                    offset: childInfo.charOffset,
                    text: (childInfo.child).text,
                    leaf: (childInfo.child)
                };
            }
            else {
                var lineNode = (childInfo.child);
                return lineNode.charOffsetToLineNumberAndPos(childInfo.lineNumber, childInfo.charOffset);
            }
        }
        else {
            var lineInfo = this.lineNumberToInfo(this.lineCount(), 0);
            return { line: this.lineCount(), offset: lineInfo.leaf.charCount() };
        }
    };
    LineNode.prototype.lineNumberToInfo = function (lineNumber, charOffset) {
        var childInfo = this.childFromLineNumber(lineNumber, charOffset);
        if (childInfo.child.isLeaf()) {
            return {
                line: lineNumber,
                offset: childInfo.charOffset,
                text: (childInfo.child).text,
                leaf: (childInfo.child)
            };
        }
        else {
            var lineNode = (childInfo.child);
            return lineNode.lineNumberToInfo(childInfo.relativeLineNumber, childInfo.charOffset);
        }
    };
    LineNode.prototype.childFromLineNumber = function (lineNumber, charOffset) {
        var child;
        var relativeLineNumber = lineNumber;
        for (var i = 0, len = this.children.length; i < len; i++) {
            child = this.children[i];
            var childLineCount = child.lineCount();
            if (childLineCount >= relativeLineNumber) {
                break;
            }
            else {
                relativeLineNumber -= childLineCount;
                charOffset += child.charCount();
            }
        }
        return {
            child: child,
            childIndex: i,
            relativeLineNumber: relativeLineNumber,
            charOffset: charOffset
        };
    };
    LineNode.prototype.childFromCharOffset = function (lineNumber, charOffset) {
        var child;
        for (var i = 0, len = this.children.length; i < len; i++) {
            child = this.children[i];
            if (child.charCount() > charOffset) {
                break;
            }
            else {
                charOffset -= child.charCount();
                lineNumber += child.lineCount();
            }
        }
        return {
            child: child,
            childIndex: i,
            charOffset: charOffset,
            lineNumber: lineNumber
        };
    };
    LineNode.prototype.splitAfter = function (childIndex) {
        var splitNode;
        var clen = this.children.length;
        childIndex++;
        var endLength = childIndex;
        if (childIndex < clen) {
            splitNode = new LineNode();
            while (childIndex < clen) {
                splitNode.add(this.children[childIndex++]);
            }
            splitNode.updateCounts();
        }
        this.children.length = endLength;
        return splitNode;
    };
    LineNode.prototype.remove = function (child) {
        var childIndex = this.findChildIndex(child);
        var clen = this.children.length;
        if (childIndex < (clen - 1)) {
            for (var i = childIndex; i < (clen - 1); i++) {
                this.children[i] = this.children[i + 1];
            }
        }
        this.children.length--;
    };
    LineNode.prototype.findChildIndex = function (child) {
        var childIndex = 0;
        var clen = this.children.length;
        while ((this.children[childIndex] != child) && (childIndex < clen))
            childIndex++;
        return childIndex;
    };
    LineNode.prototype.insertAt = function (child, nodes) {
        var childIndex = this.findChildIndex(child);
        var clen = this.children.length;
        var nodeCount = nodes.length;
        // if child is last and there is more room and only one node to place, place it
        if ((clen < lineCollectionCapacity) && (childIndex == (clen - 1)) && (nodeCount == 1)) {
            this.add(nodes[0]);
            this.updateCounts();
            return [];
        }
        else {
            var shiftNode = this.splitAfter(childIndex);
            var nodeIndex = 0;
            childIndex++;
            while ((childIndex < lineCollectionCapacity) && (nodeIndex < nodeCount)) {
                this.children[childIndex++] = nodes[nodeIndex++];
            }
            var splitNodes = [];
            var splitNodeCount = 0;
            if (nodeIndex < nodeCount) {
                splitNodeCount = Math.ceil((nodeCount - nodeIndex) / lineCollectionCapacity);
                splitNodes = new Array(splitNodeCount);
                var splitNodeIndex = 0;
                for (var i = 0; i < splitNodeCount; i++) {
                    splitNodes[i] = new LineNode();
                }
                var splitNode = splitNodes[0];
                while (nodeIndex < nodeCount) {
                    splitNode.add(nodes[nodeIndex++]);
                    if (splitNode.children.length == lineCollectionCapacity) {
                        splitNodeIndex++;
                        splitNode = splitNodes[splitNodeIndex];
                    }
                }
                for (i = splitNodes.length - 1; i >= 0; i--) {
                    if (splitNodes[i].children.length == 0) {
                        splitNodes.length--;
                    }
                }
            }
            if (shiftNode) {
                splitNodes[splitNodes.length] = shiftNode;
            }
            this.updateCounts();
            for (i = 0; i < splitNodeCount; i++) {
                splitNodes[i].updateCounts();
            }
            return splitNodes;
        }
    };
    // assume there is room for the item; return true if more room
    LineNode.prototype.add = function (collection) {
        this.children[this.children.length] = collection;
        return (this.children.length < lineCollectionCapacity);
    };
    LineNode.prototype.charCount = function () {
        return this.totalChars;
    };
    LineNode.prototype.lineCount = function () {
        return this.totalLines;
    };
    return LineNode;
})();
exports.LineNode = LineNode;
var LineLeaf = (function () {
    function LineLeaf(text) {
        this.text = text;
    }
    LineLeaf.prototype.setUdata = function (data) {
        this.udata = data;
    };
    LineLeaf.prototype.getUdata = function () {
        return this.udata;
    };
    LineLeaf.prototype.isLeaf = function () {
        return true;
    };
    LineLeaf.prototype.walk = function (rangeStart, rangeLength, walkFns) {
        walkFns.leaf(rangeStart, rangeLength, this);
    };
    LineLeaf.prototype.charCount = function () {
        return this.text.length;
    };
    LineLeaf.prototype.lineCount = function () {
        return 1;
    };
    LineLeaf.prototype.print = function (indentAmt) {
        var strBuilder = getIndent(indentAmt);
        printLine(strBuilder + showLines(this.text));
    };
    return LineLeaf;
})();
exports.LineLeaf = LineLeaf;
