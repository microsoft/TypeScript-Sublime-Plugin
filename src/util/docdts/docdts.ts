    /// <reference path='../../../node_modules/typescript/bin/typescript.d.ts'/>
/// <reference path='../../../node_modules/typescript/bin/typescript_internal.d.ts'/>
/// <reference path='node.d.ts'/>

import ts = require("typescript");

export function test1(sourceFile: ts.SourceFile) {
    if (sourceFile.fileName.indexOf('lib.d.ts') >= 0) {
        return;
    }
    nodeName(sourceFile);

    function getDoc(symbol: ts.Symbol) {
        if (symbol) {
            var doc = symbol.getDocumentationComment();
            if (doc) {
                return ts.displayPartsToString(doc);
            }
        }
        else return "";
    }

    function nodeName(node: ts.Node) {
        var props: ts.Symbol[];
        switch (node.kind) {
            case ts.SyntaxKind.InterfaceDeclaration: {
                var interfaceDecl = <ts.InterfaceDeclaration>node;
                var itype = checker.getTypeAtLocation(node);
                if (itype) {
                    props = itype.getProperties();
                    if (itype.symbol) {
                        console.log("type name " + itype.symbol.name);
                    }
                    console.log("n props " + props.length);
                }
                console.log("  interface " + interfaceDecl.name.getText() + " " + getDoc(interfaceDecl.symbol));
                break;
            }
            case ts.SyntaxKind.ModuleDeclaration: {
                var moduleDecl = <ts.ModuleDeclaration>node;
                console.log("module " + moduleDecl.name.text + " "+ getDoc(moduleDecl.symbol));
                break;
            }
            case ts.SyntaxKind.PropertyDeclaration: {
                var propDecl = <ts.PropertyDeclaration>node;
                console.log("    property " + propDecl.name.getText()+ " " + getDoc(propDecl.symbol));
                break;
            }
            case ts.SyntaxKind.PropertySignature: {
                var propSignatureDecl = <ts.PropertyDeclaration>node;
                var type = checker.getTypeOfSymbolAtLocation(propSignatureDecl.symbol, propSignatureDecl.name);
                if (type) {
                    props = type.getProperties();
                    if (type.symbol) {
                        console.log("type name " + type.symbol.name);
                    }
                    console.log("n props " + props.length);
                }
                console.log("    sproperty " + propSignatureDecl.name.getText()+ " " + getDoc(propSignatureDecl.symbol));
                break;
            }
            case ts.SyntaxKind.MethodSignature: {
                var methodSignature = <ts.MethodDeclaration>node;
                console.log("    method " + methodSignature.getText()+ " "+ getDoc(methodSignature.symbol));
                break;
            }
        }
        ts.forEachChild(node, nodeName);
    }
}

var fileNames = process.argv.slice(2);
var options: ts.CompilerOptions = { target: ts.ScriptTarget.ES5 };
var host = ts.createCompilerHost(options);
var program = ts.createProgram(fileNames, options, host);
var checker = program.getTypeChecker();

program.getSourceFiles().forEach(test1);