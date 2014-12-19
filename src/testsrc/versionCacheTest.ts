/// <reference path='../../node_modules/typescript/bin/typescript.d.ts'/>
/// <reference path='../../node_modules/typescript/bin/typescript_internal.d.ts'/>

import ts=require('typescript');
import ed=require('../service/editorServices');

var gloError = false;

function editFlat(s: number, dl: number, nt: string, source: string) {
    return source.substring(0, s) + nt + source.substring(s + dl, source.length);
}

var testDataDir = "../../tests/versionCacheTest/";

function bigTest() {
    editStress("types.ts", false);
    editStress("tst.ts", false);
    editStress("client.ts", false);
}

function recordError() {
    gloError=true; 
}

function tstTest() {
    var fname = testDataDir+'tst.ts';
    var content = ts.sys.readFile(fname);
    var lm = ed.LineIndex.linesFromText(content);
    var lines = lm.lines;
    if (lines.length == 0) {
        return;
    }
    var lineMap = lm.lineMap;

    var lineIndex = new ed.LineIndex();
    lineIndex.load(lines);

    var editedText = lineIndex.getText(0, content.length);

    var snapshot: ed.LineIndex;
    var checkText: string;
    var insertString: string;

    // change 9 1 0 1 {"y"}
    var pos =lineColToPosition(lineIndex,9,1);
    insertString = "y";
    checkText = editFlat(pos,0,insertString,content);
    snapshot = lineIndex.edit(pos, 0, insertString);
    editedText = snapshot.getText(0, checkText.length);
    if (editedText != checkText) {
        recordError();
        return;
    }

    // change 9 2 0 1 {"."}
    var pos =lineColToPosition(snapshot,9,2);
    insertString = ".";
    checkText = editFlat(pos,0,insertString,checkText);
    snapshot = snapshot.edit(pos, 0, insertString);
    editedText = snapshot.getText(0, checkText.length);
    if (editedText != checkText) {
        recordError();
        return;
    }

    // change 9 3 0 1 {"\n"}
    var pos =lineColToPosition(snapshot,9,3);
    insertString = "\n";
    checkText = editFlat(pos,0,insertString,checkText);
    snapshot = snapshot.edit(pos, 0, insertString);
    editedText = snapshot.getText(0, checkText.length);
    if (editedText != checkText) {
        recordError();
        return;
    }

    // change 10 1 0 10 {"\n\n\n\n\n\n\n\n\n\n"}
    pos =lineColToPosition(snapshot,10,1);        
    insertString = "\n\n\n\n\n\n\n\n\n\n";
    checkText = editFlat(pos,0,insertString,checkText);
    snapshot = snapshot.edit(pos, 0, insertString);
    editedText = snapshot.getText(0, checkText.length);
    if (editedText != checkText) {
        recordError();
        return;
    }

    // change 19 1 1 0
    pos =lineColToPosition(snapshot,19,1);
    checkText = editFlat(pos,1,"",checkText);
    snapshot = snapshot.edit(pos, 1);
    editedText = snapshot.getText(0, checkText.length);        
    if (editedText != checkText) {
        recordError();
        return;
    }

    // change 18 1 1 0
    pos =lineColToPosition(snapshot,18,1);
    checkText = editFlat(pos,1,"",checkText);
    snapshot = snapshot.edit(pos, 1);
    editedText = snapshot.getText(0, checkText.length);        
    if (editedText != checkText) {
        recordError();
        return;
    }

    function lineColToPosition(lineIndex:ed.LineIndex,line:number,col:number) {
        var lineInfo=lineIndex.lineNumberToInfo(line);
        return (lineInfo.offset+col-1);
    }
}

function editTest() {
    var fname = testDataDir + 'editme';
    var content = ts.sys.readFile(fname);
    var lm = ed.LineIndex.linesFromText(content);
    var lines = lm.lines;
    if (lines.length == 0) {
        return;
    }
    var lineMap = lm.lineMap;

    var lineIndex = new ed.LineIndex();
    lineIndex.load(lines);

    var editedText = lineIndex.getText(0, content.length);

    var snapshot: ed.LineIndex;
    var checkText: string;
    var insertString: string;

    // Case VII: insert at end of file
    insertString = "hmmmm...\r\n";
    checkText = editFlat(content.length,0,insertString,content);
    snapshot = lineIndex.edit(content.length, 0, insertString);
    editedText = snapshot.getText(0, checkText.length);
    if (editedText != checkText) {
        recordError();
        return;
    }

    // Case IV: unusual line endings merge
    snapshot = lineIndex.edit(lines[0].length-1,lines[1].length, "");
    editedText = snapshot.getText(0, content.length - lines[1].length);
    checkText = editFlat(lines[0].length-1, lines[1].length, "", content);
    if (editedText != checkText) {
        recordError();
        return;
    }

    // Case VIIa: delete whole line and nothing but line (last line)
    var llpos = lm.lineMap[lm.lineMap.length-2];
    snapshot = lineIndex.edit(llpos, lines[lines.length-1].length, "");
    checkText = editFlat(llpos, lines[lines.length-1].length, "" , content);
    editedText = snapshot.getText(0, checkText.length);
    if (editedText != checkText) {
        recordError();
        return;
    }

    // Case VIIb: delete whole line and nothing but line (first line)
    snapshot = lineIndex.edit(0, lines[0].length, "");
    editedText = snapshot.getText(0, content.length - lines[0].length);
    checkText = editFlat(0, lines[0].length, "" , content);
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
    editedText = snapshot.getText(0, content.length - (lines[0].length+lines[1].length));
    checkText = editFlat(0, lines[0].length+ lines[1].length, "", content);
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
    editedText = snapshot.getText(0, content.length -22);
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

function editStress(fname: string, timing: boolean) {
    var content = ts.sys.readFile(testDataDir+fname);
    var lm = ed.LineIndex.linesFromText(content);
    var lines = lm.lines;
    if (lines.length == 0) {
        return;
    }
    var lineMap = lm.lineMap;

    var lineIndex = new ed.LineIndex();
    lineIndex.load(lines);
    var totalChars = content.length;
    var rsa:number[]= [];
    var la:number[] = [];
    var las:number[] = [];
    var elas:number[] = [];
    var ersa:number[] = [];
    var ela:number[] = [];
    var etotalChars = totalChars;
    var j:number;
    
    var startTime:number;
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
        console.log("range (average length 1/4 file size): " + ((Date.now() - startTime) / 2).toFixed(3) + " us");
    }
    //        console.log("check1");
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
    //        console.log("check2");
    if (timing) {
        console.log("range (average length 4 chars): " + ((Date.now() - startTime) / 10).toFixed(3) + " us");
    }

    if (timing) {
        startTime = Date.now();
    }
    var snapshot: ed.LineIndex;
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
    //        console.log("check3");
    if (timing) {
        console.log("edit (average length 4): " + ((Date.now() - startTime) / 2).toFixed(3) + " us");
    }

    var svc = ed.ScriptVersionCache.fromString(content);
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
        console.log("edit ScriptVersionCache: " + ((Date.now() - startTime) / 2).toFixed(3) + " us");
    }

    //        console.log("check4");
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
        console.log("edit (average length 1/4th file size): " + ((Date.now() - startTime) / 5).toFixed(3) + " us");
    }

    var t: ts.LineAndCharacter;
    var errorCount = 0;
    if (timing) {
        startTime = Date.now();
    }
    //        console.log("check5");
    for (j = 0; j < 100000; j++) {
        var lp = lineIndex.charOffsetToLineNumberAndPos(rsa[j]);
        if (!timing) {
            var lac = ts.getLineAndCharacterOfPosition(lineMap,rsa[j]);

            if (lac.line != lp.line) {
                recordError();
                console.log("arrgh "+lac.line + " " + lp.line+ " " + j);
                return;
            }
            if (lac.character != (lp.offset+1)) {
                recordError();
                console.log("arrgh ch... "+lac.character + " " + (lp.offset+1)+ " " + j);
                return;
            }
        }
    }
    //        console.log("check6");
    if (timing) {
        console.log("line/offset from pos: " + ((Date.now() - startTime) / 100).toFixed(3) + " us");
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
        console.log("start pos from line: " + (((Date.now() - startTime) / lines.length) * 10).toFixed(3) + " us");
    }
}

function edTest() {
    editTest();
    tstTest();
    if (!gloError) {
        bigTest();
    }
    if (gloError) {
        console.log(" ! Fail: versionCache");
    }
    else {
        console.log("Pass"); 
    }
}

edTest();
