/// <reference path='../../node_modules/typescript/bin/typescript.d.ts'/>
/// <reference path='../../node_modules/typescript/bin/typescript_internal.d.ts'/>
/// <reference path='node.d.ts' />
/// <reference path='_debugger.d.ts' />
var __extends = this.__extends || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    __.prototype = b.prototype;
    d.prototype = new __();
};
var nodeproto = require('_debugger');
var readline = require('readline');
var path = require('path');
var ts = require('typescript');
var Editor;
(function (Editor) {
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
    (function (CharRangeSection) {
        CharRangeSection[CharRangeSection["PreStart"] = 0] = "PreStart";
        CharRangeSection[CharRangeSection["Start"] = 1] = "Start";
        CharRangeSection[CharRangeSection["Entire"] = 2] = "Entire";
        CharRangeSection[CharRangeSection["Mid"] = 3] = "Mid";
        CharRangeSection[CharRangeSection["End"] = 4] = "End";
        CharRangeSection[CharRangeSection["PostEnd"] = 5] = "PostEnd";
    })(Editor.CharRangeSection || (Editor.CharRangeSection = {}));
    var CharRangeSection = Editor.CharRangeSection;
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
            return new ts.TextChangeRange(new ts.TextSpan(this.pos, this.deleteLen), this.insertedText ? this.insertedText.length : 0);
        };
        return TextChange;
    })();
    Editor.TextChange = TextChange;
    var ScriptVersionCache = (function () {
        function ScriptVersionCache() {
            this.changes = [];
            this.versions = [];
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
                var textChangeRanges = [];
                for (var i = oldVersion + 1; i <= newVersion; i++) {
                    var snap = this.versions[i];
                    for (var j = 0, len = snap.changesSincePreviousVersion.length; j < len; j++) {
                        var textChange = snap.changesSincePreviousVersion[j];
                        textChangeRanges[textChangeRanges.length] = textChange.getTextChangeRange();
                    }
                }
                return ts.TextChangeRange.collapseChangesAcrossMultipleVersions(textChangeRanges);
            }
            else {
                return ts.TextChangeRange.unchanged;
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
    Editor.ScriptVersionCache = ScriptVersionCache;
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
                return ts.TextChangeRange.unchanged;
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
    Editor.LineIndexSnapshot = LineIndexSnapshot;
    var LineIndex = (function () {
        function LineIndex() {
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
            Editor.printLine("index TC " + this.root.charCount() + " TL " + this.root.lineCount());
            this.root.print(0);
            Editor.printLine("");
        };
        LineIndex.prototype.load = function (lines) {
            var leaves = [];
            for (var i = 0, len = lines.length; i < len; i++) {
                leaves[i] = new LineLeaf(lines[i]);
            }
            this.root = LineIndex.buildTreeFromBottom(leaves);
        };
        LineIndex.prototype.walk = function (rangeStart, rangeLength, walkFns) {
            this.root.walk(rangeStart, rangeLength, walkFns);
        };
        LineIndex.prototype.getText = function (rangeStart, rangeLength) {
            var accum = "";
            this.walk(rangeStart, rangeLength, {
                goSubtree: true,
                done: false,
                leaf: function (relativeStart, relativeLength, ll) {
                    accum = accum.concat(ll.text.substring(relativeStart, relativeStart + relativeLength));
                }
            });
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
            return walker.lineIndex;
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
    Editor.LineIndex = LineIndex;
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
            Editor.printLine(strBuilder);
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
                return undefined;
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
    Editor.LineNode = LineNode;
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
            Editor.printLine(strBuilder + showLines(this.text));
        };
        return LineLeaf;
    })();
    Editor.LineLeaf = LineLeaf;
})(Editor || (Editor = {}));
var Editor;
(function (Editor) {
    var gloError = false;
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
    function editFlat(s, dl, nt, source) {
        return source.substring(0, s) + nt + source.substring(s + dl, source.length);
    }
    function printLine(s) {
        ts.sys.write(s + '\n');
    }
    Editor.printLine = printLine;
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
    function recordError() {
        gloError = true;
    }
    function tstTest() {
        var fname = 'tst.ts';
        var content = ts.sys.readFile(fname);
        var lm = Editor.LineIndex.linesFromText(content);
        var lines = lm.lines;
        if (lines.length == 0) {
            return;
        }
        var lineMap = lm.lineMap;
        var lineIndex = new Editor.LineIndex();
        lineIndex.load(lines);
        var editedText = lineIndex.getText(0, content.length);
        var snapshot;
        var checkText;
        var insertString;
        // change 9 1 0 1 {"y"}
        var pos = lineColToPosition(lineIndex, 9, 1);
        insertString = "y";
        checkText = editFlat(pos, 0, insertString, content);
        snapshot = lineIndex.edit(pos, 0, insertString);
        editedText = snapshot.getText(0, checkText.length);
        if (editedText != checkText) {
            recordError();
            return;
        }
        // change 9 2 0 1 {"."}
        var pos = lineColToPosition(snapshot, 9, 2);
        insertString = ".";
        checkText = editFlat(pos, 0, insertString, checkText);
        snapshot = snapshot.edit(pos, 0, insertString);
        editedText = snapshot.getText(0, checkText.length);
        if (editedText != checkText) {
            recordError();
            return;
        }
        // change 9 3 0 1 {"\n"}
        var pos = lineColToPosition(snapshot, 9, 3);
        insertString = "\n";
        checkText = editFlat(pos, 0, insertString, checkText);
        snapshot = snapshot.edit(pos, 0, insertString);
        editedText = snapshot.getText(0, checkText.length);
        if (editedText != checkText) {
            recordError();
            return;
        }
        // change 10 1 0 10 {"\n\n\n\n\n\n\n\n\n\n"}
        pos = lineColToPosition(snapshot, 10, 1);
        insertString = "\n\n\n\n\n\n\n\n\n\n";
        checkText = editFlat(pos, 0, insertString, checkText);
        snapshot = snapshot.edit(pos, 0, insertString);
        editedText = snapshot.getText(0, checkText.length);
        if (editedText != checkText) {
            recordError();
            return;
        }
        // change 19 1 1 0
        pos = lineColToPosition(snapshot, 19, 1);
        checkText = editFlat(pos, 1, "", checkText);
        snapshot = snapshot.edit(pos, 1);
        editedText = snapshot.getText(0, checkText.length);
        if (editedText != checkText) {
            recordError();
            return;
        }
        // change 18 1 1 0
        pos = lineColToPosition(snapshot, 18, 1);
        checkText = editFlat(pos, 1, "", checkText);
        snapshot = snapshot.edit(pos, 1);
        editedText = snapshot.getText(0, checkText.length);
        if (editedText != checkText) {
            recordError();
            return;
        }
        function lineColToPosition(lineIndex, line, col) {
            var lineInfo = lineIndex.lineNumberToInfo(line);
            return (lineInfo.offset + col - 1);
        }
    }
    function editTest() {
        var fname = 'editme';
        var content = ts.sys.readFile(fname);
        var lm = Editor.LineIndex.linesFromText(content);
        var lines = lm.lines;
        if (lines.length == 0) {
            return;
        }
        var lineMap = lm.lineMap;
        var lineIndex = new Editor.LineIndex();
        lineIndex.load(lines);
        var editedText = lineIndex.getText(0, content.length);
        var snapshot;
        var checkText;
        var insertString;
        // Case VII: insert at end of file
        insertString = "hmmmm...\r\n";
        checkText = editFlat(content.length, 0, insertString, content);
        snapshot = lineIndex.edit(content.length, 0, insertString);
        editedText = snapshot.getText(0, checkText.length);
        if (editedText != checkText) {
            recordError();
            return;
        }
        // Case IV: unusual line endings merge
        snapshot = lineIndex.edit(lines[0].length - 1, lines[1].length, "");
        editedText = snapshot.getText(0, content.length - lines[1].length);
        checkText = editFlat(lines[0].length - 1, lines[1].length, "", content);
        if (editedText != checkText) {
            recordError();
            return;
        }
        // Case VIIa: delete whole line and nothing but line (last line)
        var llpos = lm.lineMap[lm.lineMap.length - 2];
        snapshot = lineIndex.edit(llpos, lines[lines.length - 1].length, "");
        checkText = editFlat(llpos, lines[lines.length - 1].length, "", content);
        editedText = snapshot.getText(0, checkText.length);
        if (editedText != checkText) {
            recordError();
            return;
        }
        // Case VIIb: delete whole line and nothing but line (first line)
        snapshot = lineIndex.edit(0, lines[0].length, "");
        editedText = snapshot.getText(0, content.length - lines[0].length);
        checkText = editFlat(0, lines[0].length, "", content);
        if (editedText != checkText) {
            recordError();
            return;
        }
        // and insert with no line breaks
        insertString = "moo, moo, moo! ";
        snapshot = lineIndex.edit(0, lines[0].length, insertString);
        editedText = snapshot.getText(0, content.length - lines[0].length + insertString.length);
        checkText = editFlat(0, lines[0].length, insertString, content);
        if (editedText != checkText) {
            recordError();
            return;
        }
        // and insert with multiple line breaks
        insertString = "moo, \r\nmoo, \r\nmoo! ";
        snapshot = lineIndex.edit(0, lines[0].length, insertString);
        editedText = snapshot.getText(0, content.length - lines[0].length + insertString.length);
        checkText = editFlat(0, lines[0].length, insertString, content);
        if (editedText != checkText) {
            recordError();
            return;
        }
        snapshot = lineIndex.edit(0, lines[0].length + lines[1].length, "");
        editedText = snapshot.getText(0, content.length - (lines[0].length + lines[1].length));
        checkText = editFlat(0, lines[0].length + lines[1].length, "", content);
        if (editedText != checkText) {
            recordError();
            return;
        }
        snapshot = lineIndex.edit(lines[0].length, lines[1].length + lines[2].length, "");
        editedText = snapshot.getText(0, content.length - (lines[1].length + lines[2].length));
        checkText = editFlat(lines[0].length, lines[1].length + lines[2].length, "", content);
        if (editedText != checkText) {
            recordError();
            return;
        }
        // Case VI: insert multiple line breaks
        insertString = "cr...\r\ncr...\r\ncr...\r\ncr...\r\ncr...\r\ncr...\r\ncr...\r\ncr...\r\ncr...\r\ncr...\r\ncr...\r\ncr";
        snapshot = lineIndex.edit(21, 1, insertString);
        editedText = snapshot.getText(0, content.length + insertString.length - 1);
        checkText = editFlat(21, 1, insertString, content);
        if (editedText != checkText) {
            recordError();
            return;
        }
        insertString = "cr...\r\ncr...\r\ncr";
        snapshot = lineIndex.edit(21, 1, insertString);
        editedText = snapshot.getText(0, content.length + insertString.length - 1);
        checkText = editFlat(21, 1, insertString, content);
        if (editedText != checkText) {
            recordError();
            return;
        }
        // leading '\n'
        insertString = "\ncr...\r\ncr...\r\ncr";
        snapshot = lineIndex.edit(21, 1, insertString);
        editedText = snapshot.getText(0, content.length + insertString.length - 1);
        checkText = editFlat(21, 1, insertString, content);
        if (editedText != checkText) {
            recordError();
            return;
        }
        // Case I: single line no line breaks deleted or inserted
        // delete 1 char
        snapshot = lineIndex.edit(21, 1);
        editedText = snapshot.getText(0, content.length - 1);
        checkText = editFlat(21, 1, "", content);
        if (editedText != checkText) {
            recordError();
            return;
        }
        // insert 1 char
        snapshot = lineIndex.edit(21, 0, "b");
        editedText = snapshot.getText(0, content.length + 1);
        checkText = editFlat(21, 0, "b", content);
        if (editedText != checkText) {
            recordError();
            return;
        }
        // delete 1, insert 2
        snapshot = lineIndex.edit(21, 1, "cr");
        editedText = snapshot.getText(0, content.length + 1);
        checkText = editFlat(21, 1, "cr", content);
        if (editedText != checkText) {
            recordError();
            return;
        }
        // Case II: delete across line break
        snapshot = lineIndex.edit(21, 22);
        editedText = snapshot.getText(0, content.length - 22);
        checkText = editFlat(21, 22, "", content);
        if (editedText != checkText) {
            recordError();
            return;
        }
        snapshot = lineIndex.edit(21, 32);
        editedText = snapshot.getText(0, content.length - 32);
        checkText = editFlat(21, 32, "", content);
        if (editedText != checkText) {
            recordError();
            return;
        }
        // Case III: delete across multiple line breaks and insert no line breaks
        snapshot = lineIndex.edit(21, 42);
        editedText = snapshot.getText(0, content.length - 42);
        checkText = editFlat(21, 42, "", content);
        if (editedText != checkText) {
            recordError();
            return;
        }
        snapshot = lineIndex.edit(21, 42, "slithery ");
        editedText = snapshot.getText(0, content.length - 33);
        checkText = editFlat(21, 42, "slithery ", content);
        if (editedText != checkText) {
            recordError();
            return;
        }
    }
    function editStress(fname, timing) {
        var content = ts.sys.readFile(fname);
        var lm = Editor.LineIndex.linesFromText(content);
        var lines = lm.lines;
        if (lines.length == 0) {
            return;
        }
        var lineMap = lm.lineMap;
        var lineIndex = new Editor.LineIndex();
        lineIndex.load(lines);
        var totalChars = content.length;
        var rsa = [];
        var la = [];
        var las = [];
        var elas = [];
        var ersa = [];
        var ela = [];
        var etotalChars = totalChars;
        var j;
        var startTime;
        for (j = 0; j < 100000; j++) {
            rsa[j] = Math.floor(Math.random() * totalChars);
            la[j] = Math.floor(Math.random() * (totalChars - rsa[j]));
            if (la[j] > 4) {
                las[j] = 4;
            }
            else {
                las[j] = la[j];
            }
            if (j < 4000) {
                ersa[j] = Math.floor(Math.random() * etotalChars);
                ela[j] = Math.floor(Math.random() * (etotalChars - ersa[j]));
                if (ela[j] > 4) {
                    elas[j] = 4;
                }
                else {
                    elas[j] = ela[j];
                }
                etotalChars += (las[j] - elas[j]);
            }
        }
        if (timing) {
            startTime = Date.now();
        }
        for (j = 0; j < 2000; j++) {
            var s2 = lineIndex.getText(rsa[j], la[j]);
            if (!timing) {
                var s1 = content.substring(rsa[j], rsa[j] + la[j]);
                if (s1 != s2) {
                    recordError();
                    return;
                }
            }
        }
        if (timing) {
            printLine("range (average length 1/4 file size): " + ((Date.now() - startTime) / 2).toFixed(3) + " us");
        }
        //        printLine("check1");
        if (timing) {
            startTime = Date.now();
        }
        for (j = 0; j < 10000; j++) {
            var s2 = lineIndex.getText(rsa[j], las[j]);
            if (!timing) {
                var s1 = content.substring(rsa[j], rsa[j] + las[j]);
                if (s1 != s2) {
                    recordError();
                    return;
                }
            }
        }
        //        printLine("check2");
        if (timing) {
            printLine("range (average length 4 chars): " + ((Date.now() - startTime) / 10).toFixed(3) + " us");
        }
        if (timing) {
            startTime = Date.now();
        }
        var snapshot;
        for (j = 0; j < 2000; j++) {
            var insertString = content.substring(rsa[100000 - j], rsa[100000 - j] + las[100000 - j]);
            snapshot = lineIndex.edit(rsa[j], las[j], insertString);
            if (!timing) {
                var checkText = editFlat(rsa[j], las[j], insertString, content);
                var snapText = snapshot.getText(0, checkText.length);
                if (checkText != snapText) {
                    if (s1 != s2) {
                        recordError();
                        return;
                    }
                }
            }
        }
        //        printLine("check3");
        if (timing) {
            printLine("edit (average length 4): " + ((Date.now() - startTime) / 2).toFixed(3) + " us");
        }
        var svc = Editor.ScriptVersionCache.fromString(content);
        checkText = content;
        if (timing) {
            startTime = Date.now();
        }
        for (j = 0; j < 2000; j++) {
            insertString = content.substring(rsa[j], rsa[j] + las[j]);
            svc.edit(ersa[j], elas[j], insertString);
            if (!timing) {
                checkText = editFlat(ersa[j], elas[j], insertString, checkText);
            }
            if (0 == (j % 4)) {
                var snap = svc.getSnapshot();
                if (!timing) {
                    snapText = snap.getText(0, checkText.length);
                    if (checkText != snapText) {
                        if (s1 != s2) {
                            recordError();
                            return;
                        }
                    }
                }
            }
        }
        if (timing) {
            printLine("edit ScriptVersionCache: " + ((Date.now() - startTime) / 2).toFixed(3) + " us");
        }
        //        printLine("check4");
        if (timing) {
            startTime = Date.now();
        }
        for (j = 0; j < 5000; j++) {
            insertString = content.substring(rsa[100000 - j], rsa[100000 - j] + la[100000 - j]);
            snapshot = lineIndex.edit(rsa[j], la[j], insertString);
            if (!timing) {
                checkText = editFlat(rsa[j], la[j], insertString, content);
                snapText = snapshot.getText(0, checkText.length);
                if (checkText != snapText) {
                    if (s1 != s2) {
                        recordError();
                        return;
                    }
                }
            }
        }
        if (timing) {
            printLine("edit (average length 1/4th file size): " + ((Date.now() - startTime) / 5).toFixed(3) + " us");
        }
        var t;
        var errorCount = 0;
        if (timing) {
            startTime = Date.now();
        }
        for (j = 0; j < 100000; j++) {
            var lp = lineIndex.charOffsetToLineNumberAndPos(rsa[j]);
            if (!timing) {
                var lac = ts.getLineAndCharacterOfPosition(lineMap, rsa[j]);
                if (lac.line != lp.line) {
                    recordError();
                    printLine("arrgh " + lac.line + " " + lp.line + " " + j);
                    return;
                }
                if (lac.character != (lp.offset + 1)) {
                    recordError();
                    printLine("arrgh ch... " + lac.character + " " + (lp.offset + 1) + " " + j);
                    return;
                }
            }
        }
        //        printLine("check6");
        if (timing) {
            printLine("line/offset from pos: " + ((Date.now() - startTime) / 100).toFixed(3) + " us");
        }
        if (timing) {
            startTime = Date.now();
        }
        var outer = 1;
        if (timing) {
            outer = 100;
        }
        for (var ko = 0; ko < outer; ko++) {
            for (var k = 0, llen = lines.length; k < llen; k++) {
                var lineInfo = lineIndex.lineNumberToInfo(k + 1);
                var lineIndexOffset = lineInfo.offset;
                if (!timing) {
                    var lineMapOffset = lineMap[k];
                    if (lineIndexOffset != lineMapOffset) {
                        recordError();
                        return;
                    }
                }
            }
        }
        if (timing) {
            printLine("start pos from line: " + (((Date.now() - startTime) / lines.length) * 10).toFixed(3) + " us");
        }
    }
    var ScriptInfo = (function () {
        function ScriptInfo(filename, content, isOpen) {
            if (isOpen === void 0) { isOpen = true; }
            this.filename = filename;
            this.content = content;
            this.isOpen = isOpen;
            this.isRoot = false;
            this.children = [];
            this.svc = Editor.ScriptVersionCache.fromString(content);
        }
        ScriptInfo.prototype.addChild = function (childInfo) {
            this.children.push(childInfo);
        };
        ScriptInfo.prototype.snap = function () {
            return this.svc.getSnapshot();
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
    Editor.ScriptInfo = ScriptInfo;
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
    Editor.CancellationToken = CancellationToken;
    var LSHost = (function () {
        function LSHost(cancellationToken) {
            if (cancellationToken === void 0) { cancellationToken = CancellationToken.None; }
            this.cancellationToken = cancellationToken;
            this.ls = null;
            this.compilationSettings = null;
            this.filenameToScript = {};
            this.logger = this;
            this.addDefaultLibrary();
        }
        LSHost.prototype.cancel = function () {
            this.cancellationToken.cancel();
        };
        LSHost.prototype.trace = function (str) {
        };
        LSHost.prototype.error = function (str) {
        };
        LSHost.prototype.reset = function () {
            this.cancellationToken.reset();
        };
        LSHost.prototype.addDefaultLibrary = function () {
            this.addFile("/home/steve/src/TypeScript/built/local/lib.core.d.ts");
        };
        LSHost.prototype.getScriptSnapshot = function (filename) {
            return this.getScriptInfo(filename).snap();
        };
        LSHost.prototype.getCompilationSettings = function () {
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
        LSHost.prototype.getLocalizedDiagnosticMessages = function () {
            return "";
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
        LSHost.prototype.addFile = function (name) {
            var content = ts.sys.readFile(name);
            this.addScript(name, content);
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
        LSHost.prototype.addScript = function (filename, content) {
            var script = new ScriptInfo(filename, content);
            this.filenameToScript[filename] = script;
            return script;
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
         * @param line 1 based index
         * @param col 1 based index
        */
        LSHost.prototype.lineColToPosition = function (filename, line, col) {
            var script = this.filenameToScript[filename];
            var index = script.snap().index;
            var lineInfo = index.lineNumberToInfo(line);
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
    Editor.LSHost = LSHost;
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
        function Project(root) {
            this.root = root;
            this.compilerService = new CompilerService();
            this.addGraph(root);
            this.compilerService.languageService.getNavigateToItems(".*");
        }
        Project.prototype.addGraph = function (scriptInfo) {
            if (this.addScript(scriptInfo)) {
                for (var i = 0, clen = scriptInfo.children.length; i < clen; i++) {
                    this.addGraph(scriptInfo.children[i]);
                }
            }
        };
        Project.prototype.addScript = function (info) {
            info.activeProject = this;
            return this.compilerService.host.addScriptInfo(info);
        };
        Project.prototype.printFiles = function () {
            var filenames = this.compilerService.host.getScriptFileNames();
            filenames.map(function (filename) {
                console.log(filename);
            });
        };
        return Project;
    })();
    Editor.Project = Project;
    var ProjectService = (function () {
        function ProjectService() {
            this.filenameToScriptInfo = {};
            this.roots = [];
            this.projects = [];
            this.rootsChanged = false;
            this.newRootDisjoint = true;
        }
        ProjectService.prototype.getProjectForFile = function (filename) {
            var scriptInfo = ts.lookUp(this.filenameToScriptInfo, filename);
            if (scriptInfo) {
                return scriptInfo.activeProject;
            }
        };
        ProjectService.prototype.printProjects = function () {
            for (var i = 0, len = this.projects.length; i < len; i++) {
                var project = this.projects[i];
                console.log("Project " + i.toString());
                project.printFiles();
                console.log("-----------------------------------------------");
            }
        };
        ProjectService.prototype.removeRoot = function (info) {
            var len = this.roots.length;
            for (var i = 0; i < len; i++) {
                if (this.roots[i] == info) {
                    if (i < (len - 1)) {
                        this.roots[i] = this.roots[len - 1];
                    }
                    this.roots.length--;
                    this.rootsChanged = true;
                    info.isRoot = false;
                    return true;
                }
            }
            return false;
        };
        ProjectService.prototype.openSpecifiedFile = function (filename) {
            this.rootsChanged = false;
            this.newRootDisjoint = true;
            var info = this.openFile(filename, true);
            if (this.rootsChanged) {
                var i = 0;
                var len = this.roots.length;
                if (this.newRootDisjoint) {
                    i = len - 1;
                }
                for (; i < len; i++) {
                    var root = this.roots[i];
                    root.isRoot = true;
                    this.projects[i] = new Project(root);
                }
            }
            return info;
        };
        /**
         * @param filename is absolute pathname
        */
        ProjectService.prototype.openFile = function (filename, possibleRoot) {
            if (possibleRoot === void 0) { possibleRoot = false; }
            //console.log("opening "+filename+"...");
            filename = ts.normalizePath(filename);
            var dirPath = ts.getDirectoryPath(filename);
            //console.log("normalized as "+filename+" with dir path "+dirPath);
            var info = ts.lookUp(this.filenameToScriptInfo, filename);
            if (!info) {
                var content = ts.sys.readFile(filename);
                if (content) {
                    info = new ScriptInfo(filename, content);
                    this.filenameToScriptInfo[filename] = info;
                    if (possibleRoot) {
                        this.roots.push(info);
                        this.rootsChanged = true;
                    }
                    var preProcessedInfo = ts.preProcessFile(content, false);
                    if (preProcessedInfo.referencedFiles.length > 0) {
                        for (var i = 0, len = preProcessedInfo.referencedFiles.length; i < len; i++) {
                            var refFilename = ts.normalizePath(preProcessedInfo.referencedFiles[i].filename);
                            refFilename = getAbsolutePath(refFilename, dirPath);
                            var refInfo = this.openFile(refFilename);
                            if (refInfo) {
                                info.addChild(refInfo);
                            }
                        }
                    }
                }
                else {
                }
            }
            if ((!possibleRoot) && (info) && (info.isRoot)) {
                if (this.removeRoot(info)) {
                    this.rootsChanged = true;
                    this.newRootDisjoint = false;
                }
            }
            return info;
        };
        return ProjectService;
    })();
    Editor.ProjectService = ProjectService;
    var CompilerService = (function () {
        function CompilerService() {
            // TODO: add usable cancellation token
            this.cancellationToken = new CancellationToken();
            this.host = new LSHost(this.cancellationToken);
            this.settings = ts.getDefaultCompilerOptions();
            this.documentRegistry = ts.createDocumentRegistry();
            this.formatCodeOptions = {
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
            this.languageService = ts.createLanguageService(this.host, this.documentRegistry);
            this.classifier = ts.createClassifier(this.host);
        }
        /**
         * @param filename is absolute pathname
        */
        CompilerService.prototype.openFile = function (filename) {
            //console.log("opening "+filename+"...");
            filename = ts.normalizePath(filename);
            var dirPath = ts.getDirectoryPath(filename);
            //console.log("normalized as "+filename+" with dir path "+dirPath);
            var info = this.host.getScriptInfo(filename);
            if (info == null) {
                var content = ts.sys.readFile(filename);
                if (content) {
                    info = this.host.addScript(filename, content);
                    var preProcessedInfo = ts.preProcessFile(content, false);
                    if (preProcessedInfo.referencedFiles.length > 0) {
                        for (var i = 0, len = preProcessedInfo.referencedFiles.length; i < len; i++) {
                            var refFilename = ts.normalizePath(preProcessedInfo.referencedFiles[i].filename);
                            refFilename = getAbsolutePath(refFilename, dirPath);
                            this.openFile(refFilename);
                        }
                    }
                    console.log("opened " + filename);
                }
                else {
                }
            }
            return info;
        };
        return CompilerService;
    })();
    Editor.CompilerService = CompilerService;
    var homePrefix = "/home/steve/src/ts/versionCache/";
    var compPrefix = "/home/steve/src/TypeScript/src/compiler/";
    function bigProjTest(projectService) {
        var cfile = homePrefix + "client.ts";
        var innerFile = compPrefix + "core.ts";
        projectService.openSpecifiedFile(innerFile);
        var scriptInfo = projectService.openSpecifiedFile(cfile);
        var project = scriptInfo.activeProject;
        var compilerService = project.compilerService;
        var pos = compilerService.host.lineColToPosition(cfile, 824, 61);
        var typeInfo = compilerService.languageService.getQuickInfoAtPosition(cfile, pos);
        if (typeInfo) {
            printLine(ts.displayPartsToString(typeInfo.displayParts));
            projectService.printProjects();
        }
    }
    function lsProjTest(tstname, projectService, goBig) {
        if (goBig === void 0) { goBig = false; }
        var tfile = homePrefix + tstname;
        var zfile = homePrefix + "z.ts";
        var scriptInfo = projectService.openSpecifiedFile(tfile);
        var project = scriptInfo.activeProject;
        var compilerService = project.compilerService;
        var typeInfo = compilerService.languageService.getQuickInfoAtPosition(zfile, 0);
        printLine(ts.displayPartsToString(typeInfo.displayParts));
        compilerService.host.editScript(zfile, 2, 9, "zebra");
        typeInfo = compilerService.languageService.getQuickInfoAtPosition(zfile, 2);
        printLine(ts.displayPartsToString(typeInfo.displayParts));
        compilerService.host.editScript(zfile, 2, 7, "giraffe");
        typeInfo = compilerService.languageService.getQuickInfoAtPosition(zfile, 2);
        printLine(ts.displayPartsToString(typeInfo.displayParts));
        var snapshot = compilerService.host.getScriptSnapshot(zfile);
        var text = snapshot.getText(0, snapshot.getLength());
        var tinsertString = "class Manimal {\r\n    location: Point;\r\n}\r\n";
        compilerService.host.editScript(tfile, 0, 0, tinsertString);
        var insertString = ";\r\nvar m = new Manimal();\r\nm.location";
        compilerService.host.editScript(zfile, text.length - 1, text.length - 1, insertString);
        var offset = text.length + 28;
        typeInfo = compilerService.languageService.getQuickInfoAtPosition(zfile, offset);
        printLine(ts.displayPartsToString(typeInfo.displayParts));
        if (goBig) {
            bigProjTest(projectService);
        }
    }
    Editor.lsProjTest = lsProjTest;
    function lsTest() {
        var compilerService = new CompilerService();
        var tfile = homePrefix + "tst.ts";
        var zfile = homePrefix + "z.ts";
        var info = compilerService.openFile(tfile);
        var typeInfo = compilerService.languageService.getQuickInfoAtPosition(zfile, 0);
        printLine(ts.displayPartsToString(typeInfo.displayParts));
        compilerService.host.editScript(zfile, 2, 9, "zebra");
        typeInfo = compilerService.languageService.getQuickInfoAtPosition(zfile, 2);
        printLine(ts.displayPartsToString(typeInfo.displayParts));
        compilerService.host.editScript(zfile, 2, 7, "giraffe");
        typeInfo = compilerService.languageService.getQuickInfoAtPosition(zfile, 2);
        printLine(ts.displayPartsToString(typeInfo.displayParts));
        var snapshot = compilerService.host.getScriptSnapshot(zfile);
        var text = snapshot.getText(0, snapshot.getLength());
        var tinsertString = "class Manimal {\r\n    location: Point;\r\n}\r\n";
        compilerService.host.editScript(tfile, 0, 0, tinsertString);
        var insertString = ";\r\nvar m = new Manimal();\r\nm.location";
        compilerService.host.editScript(zfile, text.length - 1, text.length - 1, insertString);
        var offset = text.length + 28;
        typeInfo = compilerService.languageService.getQuickInfoAtPosition(zfile, offset);
        printLine(ts.displayPartsToString(typeInfo.displayParts));
        /*
        if (typeInfo.memberName.toString()!="Point") {
            recordError();
            return;
        }
        */
    }
    Editor.lsTest = lsTest;
    function bigTest() {
        //        editStress("../../TypeScript/src/lib/dom.generated.d.ts", false);
        editStress("../../TypeScript/src/compiler/types.ts", false);
        editStress("tst.ts", false);
        editStress("client.ts", false);
        //        editStress("..\\..\\TypeScript\\src\\lib\\dom.generated.d.ts", false);
    }
    function edTest() {
        editTest();
        tstTest();
        if (!gloError) {
            lsTest();
        }
        if (!gloError) {
            var projectService = new ProjectService();
            lsProjTest("tst.ts", projectService);
            lsProjTest("auxtst.ts", projectService, true);
        }
        if (!gloError) {
            bigTest();
        }
        if (gloError) {
            printLine(" ! Fail: versionCache");
        }
        else {
            printLine("Pass");
        }
    }
    Editor.edTest = edTest;
})(Editor || (Editor = {}));
var rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
});
var paddedLength = 8;
var typeNames = ["interface", "class", "enum", "module", "alias", "type"];
function printObject(obj) {
    for (var p in obj) {
        if (obj.hasOwnProperty(p)) {
            console.log(p + ": " + obj[p]);
        }
    }
}
function isTypeName(name, suffix) {
    for (var i = 0, len = typeNames.length; i < len; i++) {
        if (typeNames[i] == name) {
            return true;
        }
        else if (suffix && ((typeNames[i] + suffix) == name)) {
            return true;
        }
    }
    return false;
}
function parseTypeName(displayParts) {
    var len = displayParts.length;
    for (var i = len - 1; i >= 0; i--) {
        if (isTypeName(displayParts[i].kind, "Name")) {
            return displayParts[i].text;
        }
    }
    return undefined;
}
function findExactMatchType(items) {
    for (var i = 0, len = items.length; i < len; i++) {
        var navItem = items[i];
        if (navItem.matchKind == "exact") {
            if (isTypeName(navItem.kind)) {
                return navItem;
            }
        }
    }
}
function sortNavItems(items) {
    return items.sort(function (a, b) {
        if (a.matchKind < b.matchKind) {
            return -1;
        }
        else if (a.matchKind == b.matchKind) {
            var lowa = a.name.toLowerCase();
            var lowb = b.name.toLowerCase();
            if (lowa < lowb) {
                return -1;
            }
            else if (lowa == lowb) {
                return 0;
            }
            else {
                return 1;
            }
        }
        else {
            return 1;
        }
    });
}
function SourceInfo(body) {
    var result = body.exception ? 'exception in ' : 'break in ';
    if (body.script) {
        if (body.script.name) {
            var name = body.script.name, dir = path.resolve() + '/';
            // Change path to relative, if possible
            if (name.indexOf(dir) === 0) {
                name = name.slice(dir.length);
            }
            result += name;
        }
        else {
            result += '[unnamed]';
        }
    }
    result += ':';
    result += body.sourceLine + 1;
    if (body.exception)
        result += '\n' + body.exception.text;
    return result;
}
var JsDebugSession = (function () {
    function JsDebugSession() {
        this.host = 'localhost';
        this.port = 5858;
        this.init();
    }
    JsDebugSession.prototype.cont = function (cb) {
        this.client.reqContinue(cb);
    };
    JsDebugSession.prototype.listSrc = function () {
        var _this = this;
        this.client.reqScripts(function (err) {
            if (err) {
                console.log("rscr error: " + err);
            }
            else {
                console.log("req scripts");
                for (var id in _this.client.scripts) {
                    var script = _this.client.scripts[id];
                    if ((typeof script === "object") && script.name) {
                        console.log(id + ": " + script.name);
                    }
                }
            }
        });
    };
    JsDebugSession.prototype.findScript = function (file) {
        if (file) {
            var script;
            var scripts = this.client.scripts;
            var keys = Object.keys(scripts);
            var ambiguous = false;
            for (var v = 0; v < keys.length; v++) {
                var id = keys[v];
                if (scripts[id] && scripts[id].name && scripts[id].name.indexOf(file) !== -1) {
                    if (script) {
                        ambiguous = true;
                    }
                    script = scripts[id];
                }
            }
            return { script: script, ambiguous: ambiguous };
        }
    };
    // TODO: condition
    JsDebugSession.prototype.setBreakpointOnLine = function (line, file) {
        if (!file) {
            file = this.client.currentScript;
        }
        var script;
        var scriptResult = this.findScript(file);
        if (scriptResult) {
            if (scriptResult.ambiguous) {
                // TODO: send back error
                script = undefined;
            }
            else {
                script = scriptResult.script;
            }
        }
        // TODO: set breakpoint when script not loaded
        if (script) {
            var brkmsg = {
                type: 'scriptId',
                target: script.id,
                line: line - 1
            };
            this.client.setBreakpoint(brkmsg, function (err, bod) {
                // TODO: remember breakpoint
                if (err) {
                    console.log("Error: set breakpoint: " + err);
                }
            });
        }
    };
    JsDebugSession.prototype.init = function () {
        var _this = this;
        var connectionAttempts = 0;
        this.client = new nodeproto.Client();
        this.client.on('break', function (res) {
            _this.handleBreak(res.body);
        });
        this.client.on('exception', function (res) {
            _this.handleBreak(res.body);
        });
        this.client.on('error', function () {
            setTimeout(function () {
                ++connectionAttempts;
                _this.client.connect(_this.port, _this.host);
            }, 500);
        });
        this.client.once('ready', function () {
        });
        this.client.on('unhandledResponse', function () {
        });
        this.client.connect(this.port, this.host);
    };
    JsDebugSession.prototype.evaluate = function (code) {
        var _this = this;
        var frame = this.client.currentFrame;
        this.client.reqFrameEval(code, frame, function (err, bod) {
            if (err) {
                console.log("Error: evaluate: " + err);
                return;
            }
            console.log("Value: " + bod.toString());
            if (typeof bod === "object") {
                printObject(bod);
            }
            // Request object by handles (and it's sub-properties)
            _this.client.mirrorObject(bod, 3, function (err, mirror) {
                if (mirror) {
                    if (typeof mirror === "object") {
                        printObject(mirror);
                    }
                    console.log(mirror.toString());
                }
                else {
                    console.log("undefined");
                }
            });
        });
    };
    JsDebugSession.prototype.handleBreak = function (breakInfo) {
        this.client.currentSourceLine = breakInfo.sourceLine;
        this.client.currentSourceLineText = breakInfo.sourceLineText;
        this.client.currentSourceColumn = breakInfo.sourceColumn;
        this.client.currentFrame = 0;
        this.client.currentScript = breakInfo.script && breakInfo.script.name;
        console.log(SourceInfo(breakInfo));
        // TODO: watchers        
    };
    return JsDebugSession;
})();
var Session = (function () {
    function Session(useProtocol) {
        if (useProtocol === void 0) { useProtocol = false; }
        this.projectService = new Editor.ProjectService();
        this.prettyJSON = false;
        this.pendingOperation = false;
        this.fileHash = {};
        this.fetchedAbbrev = false;
        this.nextFileId = 1;
        this.initAbbrevTable();
        if (useProtocol) {
            this.initProtocol();
        }
    }
    Session.prototype.initProtocol = function () {
        var _this = this;
        this.protocol = new nodeproto.Protocol();
        // note: onResponse was named by nodejs authors; we are re-purposing the Protocol
        // class in this case so that it supports a server instead of a client
        this.protocol.onResponse = function (pkt) {
            _this.handleRequest(pkt);
        };
    };
    Session.prototype.handleRequest = function (req) {
        // TODO: so far requests always come in on stdin
    };
    Session.prototype.send = function (msg) {
        var json;
        if (this.prettyJSON) {
            json = JSON.stringify(msg, null, " ");
        }
        else {
            json = JSON.stringify(msg);
        }
        console.log('Content-Length: ' + (1 + Buffer.byteLength(json, 'utf8')) + '\r\n\r\n' + json);
    };
    Session.prototype.event = function (info, eventName) {
        var ev = {
            seq: 0,
            type: "event",
            event: eventName,
            body: info
        };
        this.send(ev);
    };
    Session.prototype.response = function (info, reqSeq, errorMsg) {
        if (reqSeq === void 0) { reqSeq = 0; }
        var res = {
            seq: 0,
            type: "response",
            request_seq: reqSeq,
            success: !errorMsg
        };
        if (!errorMsg) {
            res.body = info;
        }
        else {
            res.message = errorMsg;
        }
        this.send(res);
    };
    Session.prototype.initAbbrevTable = function () {
        this.abbrevTable = {
            name: "n",
            kind: "k",
            fileName: "f",
            containerName: "c",
            containerKind: "ck",
            min: "m",
            line: "l",
            offset: "o",
            "interface": "i",
            "function": "fn"
        };
    };
    // TODO: use union type for return type
    Session.prototype.encodeFilename = function (filename) {
        var id = ts.lookUp(this.fileHash, filename);
        if (!id) {
            id = this.nextFileId++;
            this.fileHash[filename] = id;
            return { id: id, fileName: filename };
        }
        else {
            return id;
        }
    };
    Session.prototype.abbreviate = function (obj) {
        if (this.fetchedAbbrev && (!this.prettyJSON)) {
            for (var p in obj) {
                if (obj.hasOwnProperty(p)) {
                    var sub = ts.lookUp(this.abbrevTable, p);
                    if (sub) {
                        obj[sub] = obj[p];
                        obj[p] = undefined;
                    }
                }
            }
        }
    };
    Session.prototype.output = function (info, errorMsg) {
        if (this.protocol) {
            this.response(info, 0, errorMsg);
        }
        else if (this.prettyJSON) {
            if (!errorMsg) {
                console.log(JSON.stringify(info, null, " ").trim());
            }
            else {
                console.log(JSON.stringify(errorMsg));
            }
        }
        else {
            if (!errorMsg) {
                var infoStr = JSON.stringify(info).trim();
                // [8 digits of length,infoStr] + '\n'
                var len = infoStr.length + paddedLength + 4;
                var lenStr = len.toString();
                var padLen = paddedLength - lenStr.length;
                for (var i = 0; i < padLen; i++) {
                    lenStr = '0' + lenStr;
                }
                console.log("[" + lenStr + "," + infoStr + "]");
            }
            else {
                console.log(JSON.stringify("error: " + errorMsg));
            }
        }
    };
    Session.prototype.updateErrorCheck = function (file, project) {
        var _this = this;
        if (this.errorTimer) {
            clearTimeout(this.errorTimer);
        }
        this.errorTimer = setTimeout(function () {
            var diags = project.compilerService.languageService.getSyntacticDiagnostics(file);
            if (diags) {
                var bakedDiags = diags.map(function (diag) { return ({
                    min: project.compilerService.host.positionToZeroBasedLineCol(file, diag.start),
                    len: diag.length,
                    text: diag.messageText
                }); });
                _this.event({ fileName: file, diagnostics: bakedDiags }, "syntaxDiag");
            }
            _this.errorTimer = undefined;
        }, 1500);
    };
    Session.prototype.listen = function () {
        var _this = this;
        //console.log("up...");
        rl.on('line', function (input) {
            var cmd = input.trim();
            var line, col, file;
            var pos;
            var m;
            var project;
            var compilerService;
            if (m = cmd.match(/^definition (\d+) (\d+) (.*)$/)) {
                line = parseInt(m[1]);
                col = parseInt(m[2]);
                file = m[3];
                project = _this.projectService.getProjectForFile(file);
                if (project) {
                    var compilerService = project.compilerService;
                    pos = compilerService.host.lineColToPosition(file, line, col);
                    var locs = compilerService.languageService.getDefinitionAtPosition(file, pos);
                    if (locs) {
                        var info = locs.map(function (def) { return ({
                            file: def && def.fileName,
                            min: def && compilerService.host.positionToZeroBasedLineCol(def.fileName, def.textSpan.start()),
                            lim: def && compilerService.host.positionToZeroBasedLineCol(def.fileName, def.textSpan.end())
                        }); });
                        _this.output(info[0] || null);
                    }
                    else {
                        _this.output(undefined, "could not find def");
                    }
                }
                else {
                    _this.output(undefined, "no project for " + file);
                }
            }
            else if (m = cmd.match(/^dbg start$/)) {
                _this.debugSession = new JsDebugSession();
            }
            else if (m = cmd.match(/^dbg cont$/)) {
                if (_this.debugSession) {
                    _this.debugSession.cont(function (err, body, res) {
                    });
                }
            }
            else if (m = cmd.match(/^dbg src$/)) {
                if (_this.debugSession) {
                    _this.debugSession.listSrc();
                }
            }
            else if (m = cmd.match(/^dbg brk (\d+) (.*)$/)) {
                line = parseInt(m[1]);
                file = m[2];
                if (_this.debugSession) {
                    _this.debugSession.setBreakpointOnLine(line, file);
                }
            }
            else if (m = cmd.match(/^dbg eval (.*)$/)) {
                var code = m[1];
                if (_this.debugSession) {
                    _this.debugSession.evaluate(code);
                }
            }
            else if (m = cmd.match(/^rename (\d+) (\d+) (.*)$/)) {
                line = parseInt(m[1]);
                col = parseInt(m[2]);
                file = m[3];
                project = _this.projectService.getProjectForFile(file);
                if (project) {
                    var compilerService = project.compilerService;
                    pos = compilerService.host.lineColToPosition(file, line, col);
                    var renameInfo = compilerService.languageService.getRenameInfo(file, pos);
                    if (renameInfo) {
                        if (renameInfo.canRename) {
                            var renameLocs = compilerService.languageService.findRenameLocations(file, pos, false, false);
                            if (renameLocs) {
                                var bakedRenameLocs = renameLocs.map(function (loc) { return ({
                                    file: loc.fileName,
                                    min: compilerService.host.positionToZeroBasedLineCol(loc.fileName, loc.textSpan.start()),
                                    lim: compilerService.host.positionToZeroBasedLineCol(loc.fileName, loc.textSpan.end())
                                }); }).sort(function (a, b) {
                                    if (a.file < b.file) {
                                        return -1;
                                    }
                                    else if (a.file > b.file) {
                                        return 1;
                                    }
                                    else {
                                        // reverse sort assuming no overlap
                                        if (a.min.line < b.min.line) {
                                            return 1;
                                        }
                                        else if (a.min.line > b.min.line) {
                                            return -1;
                                        }
                                        else {
                                            return b.min.offset - a.min.offset;
                                        }
                                    }
                                }).reduce(function (accum, cur) {
                                    var curFileAccum;
                                    if (accum.length > 0) {
                                        curFileAccum = accum[accum.length - 1];
                                        if (curFileAccum.file != cur.file) {
                                            curFileAccum = undefined;
                                        }
                                    }
                                    if (!curFileAccum) {
                                        curFileAccum = { file: cur.file, locs: [] };
                                        accum.push(curFileAccum);
                                    }
                                    curFileAccum.locs.push({ min: cur.min, lim: cur.lim });
                                    return accum;
                                }, []);
                                _this.output({ info: renameInfo, locs: bakedRenameLocs });
                            }
                            else {
                                _this.output([]);
                            }
                        }
                        else {
                            _this.output(undefined, renameInfo.localizedErrorMessage);
                        }
                    }
                    else {
                        _this.output(undefined, "no rename information at cursor");
                    }
                }
            }
            else if (m = cmd.match(/^type (\d+) (\d+) (.*)$/)) {
                line = parseInt(m[1]);
                col = parseInt(m[2]);
                file = m[3];
                project = _this.projectService.getProjectForFile(file);
                if (project) {
                    var compilerService = project.compilerService;
                    pos = compilerService.host.lineColToPosition(file, line, col);
                    var quickInfo = compilerService.languageService.getQuickInfoAtPosition(file, pos);
                    var typeLoc = "no type";
                    if ((quickInfo.kind == "var") || (quickInfo.kind == "local var")) {
                        var typeName = parseTypeName(quickInfo.displayParts);
                        if (typeName) {
                            var navItems = compilerService.languageService.getNavigateToItems(typeName);
                            var navItem = findExactMatchType(navItems);
                            if (navItem) {
                                typeLoc = {
                                    fileName: navItem.fileName,
                                    min: compilerService.host.positionToZeroBasedLineCol(navItem.fileName, navItem.textSpan.start())
                                };
                            }
                        }
                    }
                    _this.output(typeLoc);
                }
                else {
                    _this.output(undefined, "no project for " + file);
                }
            }
            else if (m = cmd.match(/^open (.*)$/)) {
                file = m[1];
                _this.projectService.openSpecifiedFile(file);
            }
            else if (m = cmd.match(/^references (\d+) (\d+) (.*)$/)) {
                line = parseInt(m[1]);
                col = parseInt(m[2]);
                file = m[3];
                project = _this.projectService.getProjectForFile(file);
                if (project) {
                    compilerService = project.compilerService;
                    pos = compilerService.host.lineColToPosition(file, line, col);
                    var refs = compilerService.languageService.getReferencesAtPosition(file, pos);
                    if (refs) {
                        var nameInfo = compilerService.languageService.getQuickInfoAtPosition(file, pos);
                        if (nameInfo) {
                            var nameSpan = nameInfo.textSpan;
                            var nameColStart = compilerService.host.positionToZeroBasedLineCol(file, nameSpan.start()).offset;
                            var nameText = compilerService.host.getScriptSnapshot(file).getText(nameSpan.start(), nameSpan.end());
                            var bakedRefs = refs.map(function (ref) { return ({
                                file: ref.fileName,
                                min: compilerService.host.positionToZeroBasedLineCol(ref.fileName, ref.textSpan.start()),
                                lim: compilerService.host.positionToZeroBasedLineCol(ref.fileName, ref.textSpan.end())
                            }); });
                            _this.output([bakedRefs, nameText, nameColStart]);
                        }
                        else {
                            _this.output(undefined, "no references at this position");
                        }
                    }
                    else {
                        _this.output(undefined, "no references at this position");
                    }
                }
            }
            else if (m = cmd.match(/^quickinfo (\d+) (\d+) (.*)$/)) {
                line = parseInt(m[1]);
                col = parseInt(m[2]);
                file = m[3];
                project = _this.projectService.getProjectForFile(file);
                if (project) {
                    compilerService = project.compilerService;
                    pos = compilerService.host.lineColToPosition(file, line, col);
                    var quickInfo = compilerService.languageService.getQuickInfoAtPosition(file, pos);
                    if (quickInfo) {
                        var displayString = ts.displayPartsToString(quickInfo.displayParts);
                        _this.output(displayString);
                    }
                    else {
                        _this.output(undefined, "no info");
                    }
                }
            }
            else if (m = cmd.match(/^formatonkey (\d+) (\d+) (\{\".*\"\})\s* (.*)$/)) {
                line = parseInt(m[1]);
                col = parseInt(m[2]);
                file = m[4];
                project = _this.projectService.getProjectForFile(file);
                if (project) {
                    compilerService = project.compilerService;
                    pos = compilerService.host.lineColToPosition(file, line, col);
                    var key = JSON.parse(m[3].substring(1, m[3].length - 1));
                    var edits;
                    try {
                        edits = compilerService.languageService.getFormattingEditsAfterKeystroke(file, pos, key, compilerService.formatCodeOptions);
                    }
                    catch (err) {
                        edits = undefined;
                    }
                    if (edits) {
                        var bakedEdits = edits.map(function (edit) {
                            return {
                                min: compilerService.host.positionToZeroBasedLineCol(file, edit.span.start()),
                                lim: compilerService.host.positionToZeroBasedLineCol(file, edit.span.end()),
                                newText: edit.newText ? edit.newText : ""
                            };
                        });
                        _this.output(bakedEdits);
                    }
                    else {
                        _this.output(undefined, "no edits");
                    }
                }
            }
            else if (m = cmd.match(/^completions (\d+) (\d+) (.*)$/)) {
                line = parseInt(m[1]);
                col = parseInt(m[2]);
                file = m[3];
                project = _this.projectService.getProjectForFile(file);
                if (project) {
                    compilerService = project.compilerService;
                    pos = compilerService.host.lineColToPosition(file, line, col);
                    var completions = compilerService.languageService.getCompletionsAtPosition(file, pos);
                    if (completions) {
                        var compressedEntries = completions.entries.map(function (entry) {
                            var protoEntry = {};
                            protoEntry.name = entry.name;
                            protoEntry.kind = entry.kind;
                            if (entry.kindModifiers && (entry.kindModifiers.length > 0)) {
                                protoEntry.kindModifiers = entry.kindModifiers;
                            }
                            var details = compilerService.languageService.getCompletionEntryDetails(file, pos, entry.name);
                            if (details && (details.documentation) && (details.documentation.length > 0)) {
                                protoEntry.documentation = details.documentation;
                            }
                            return protoEntry;
                        });
                        _this.output(compressedEntries);
                    }
                    else {
                        _this.output(undefined, "no completions");
                    }
                }
            }
            else if (m = cmd.match(/^change (\d+) (\d+) (\d+) (\d+) (\{\".*\"\})?\s*(.*)$/)) {
                line = parseInt(m[1]);
                col = parseInt(m[2]);
                var deleteLen = parseInt(m[3]);
                var insertLen = parseInt(m[4]);
                var insertString;
                if (insertLen) {
                    insertString = JSON.parse(m[5].substring(1, m[5].length - 1));
                }
                file = m[6];
                project = _this.projectService.getProjectForFile(file);
                if (project) {
                    compilerService = project.compilerService;
                    pos = compilerService.host.lineColToPosition(file, line, col);
                    compilerService.host.editScript(file, pos, pos + deleteLen, insertString);
                    _this.updateErrorCheck(file, project);
                }
            }
            else if (m = cmd.match(/^navto (\{.*\}) (.*)$/)) {
                var searchTerm = m[1];
                searchTerm = searchTerm.substring(1, searchTerm.length - 1);
                file = m[2];
                project = _this.projectService.getProjectForFile(file);
                if (project) {
                    compilerService = project.compilerService;
                    var navItems;
                    var cancellationToken = compilerService.host.getCancellationToken();
                    if (_this.pendingOperation) {
                        cancellationToken.cancel();
                        cancellationToken.reset();
                    }
                    try {
                        _this.pendingOperation = true;
                        navItems = sortNavItems(compilerService.languageService.getNavigateToItems(searchTerm));
                    }
                    catch (err) {
                        navItems = undefined;
                    }
                    _this.pendingOperation = false;
                    if (navItems) {
                        var bakedNavItems = navItems.map(function (navItem) {
                            var min = compilerService.host.positionToZeroBasedLineCol(navItem.fileName, navItem.textSpan.start());
                            _this.abbreviate(min);
                            var bakedItem = {
                                name: navItem.name,
                                kind: navItem.kind,
                                fileName: _this.encodeFilename(navItem.fileName),
                                min: min
                            };
                            if (navItem.containerName && (navItem.containerName.length > 0)) {
                                bakedItem.containerName = navItem.containerName;
                            }
                            if (navItem.containerKind && (navItem.containerKind.length > 0)) {
                                bakedItem.containerKind = navItem.containerKind;
                            }
                            _this.abbreviate(bakedItem);
                            return bakedItem;
                        });
                        _this.output(bakedNavItems);
                    }
                    else {
                        _this.output(undefined, "no nav items");
                    }
                }
            }
            else if (m = cmd.match(/^abbrev/)) {
                _this.fetchedAbbrev = true;
                _this.output(_this.abbrevTable);
            }
            else if (m = cmd.match(/^pretty/)) {
                _this.prettyJSON = true;
            }
            else {
                _this.output(undefined, "Unrecognized command " + cmd);
            }
        });
        rl.on('close', function () {
            console.log("Exiting...");
            process.exit(0);
        });
    };
    return Session;
})();
new Session(true).listen();
