/* -*- Mode: Javascript; tab-width: 4; indent-tabs-mode: nil; c-basic-offset: 4 -*- */

"use strict";

load('annotations.js');

print("<html><pre>");
print("Time: " + new Date);

var functionName;
var functionBodies;

function assert(x)
{
    if (!x)
        throw "assertion failed: " + (Error().stack);
}

function xprint(x, padding)
{
    if (!padding)
        padding = "";
    if (x instanceof Array) {
        print(padding + "[");
        for (var elem of x)
            xprint(elem, padding + " ");
        print(padding + "]");
    } else if (x instanceof Object) {
        print(padding + "{");
        for (var prop in x) {
            print(padding + " " + prop + ":");
            xprint(x[prop], padding + "  ");
        }
        print(padding + "}");
    } else {
        print(padding + x);
    }
}

if (typeof arguments[0] != 'string' || typeof arguments[1] != 'string')
    throw "Usage: analyzeRoots.js <gcFunctions.html> <gcTypes.txt>";

var gcFunctions = {};
var match;

var gcFunctionsText = snarf(arguments[0]).split('\n');
for (var line of gcFunctionsText) {
    if (match = /GC Function: (.*)/.exec(line))
        gcFunctions[match[1]] = true;
}

var gcThings = {};
var gcPointers = {};

var gcTypesText = snarf(arguments[1]).split('\n');
for (var line of gcTypesText) {
    if (match = /GCThing: (.*)/.exec(line))
        gcThings[match[1]] = true;
    if (match = /GCPointer: (.*)/.exec(line))
        gcPointers[match[1]] = true;
}

function isRootedType(type)
{
    if (type.Kind != "CSU")
        return false;

    var name = type.Name;

    if (name.startsWith('struct '))
        name = name.substr(7);
    if (name.startsWith('class '))
        name = name.substr(6);
    if (name.startsWith('const '))
        name = name.substr(6);
    if (name.startsWith('js::'))
        name = name.substr(4);
    if (name.startsWith('JS::'))
        name = name.substr(4);

    return name.startsWith('Rooted');
}

function isUnrootedType(type)
{
    if (type.Kind == "Pointer") {
        var target = type.Type;
    if (target.Kind == "CSU")
        return target.Name in gcThings;
        return false;
    }
    if (type.Kind == "CSU")
        return type.Name in gcPointers;
    return false;
}

function sameVariable(var0, var1)
{
    assert("Name" in var0 || var0.Kind == "This" || var0.Kind == "Return");
    return "Name" in var0 && var0.Name[0] == var1.Name[0];
}

function expressionUsesVariable(exp, variable, ignoreTopmost)
{
    if (!ignoreTopmost && exp.Kind == "Var" && sameVariable(exp.Variable, variable))
        return true;
    if (!("Exp" in exp))
        return false;
    for (var childExp of exp.Exp) {
        if (expressionUsesVariable(childExp, variable))
            return true;
    }
    return false;
}

function edgeUsesVariable(edge, variable)
{
    switch (edge.Kind) {
    case "Assign":
        if (expressionUsesVariable(edge.Exp[0], variable, true))
            return true;
        return expressionUsesVariable(edge.Exp[1], variable);
    case "Assume":
        return expressionUsesVariable(edge.Exp[0], variable);
    case "Call":
        if (expressionUsesVariable(edge.Exp[0], variable))
            return true;
        if (1 in edge.Exp && expressionUsesVariable(edge.Exp[1], variable, true))
            return true;
        if ("PEdgeCallInstance" in edge) {
            if (expressionUsesVariable(edge.PEdgeCallInstance.Exp, variable))
                return true;
        }
        if ("PEdgeCallArguments" in edge) {
            for (var exp of edge.PEdgeCallArguments.Exp) {
                if (expressionUsesVariable(exp, variable))
                    return true;
            }
        }
        return false;
    case "Loop":
        return false;
    default:
        xprint(edge);
        assert(false);
    }
}

function edgeKillsVariable(edge, variable)
{
    if (edge.Kind == "Assign") {
        var lhs = edge.Exp[0];
        if (lhs.Kind == "Var" && sameVariable(lhs.Variable, variable))
            return true;
    }
    if (edge.Kind == "Call" && 1 in edge.Exp) {
        var lhs = edge.Exp[1];
        if (lhs.Kind == "Var" && sameVariable(lhs.Variable, variable))
            return true;
    }
    return false;
}

function edgeCanGC(edge)
{
    if (edge.Kind != "Call")
        return false;
    var callee = edge.Exp[0];
    if (callee.Kind == "Var") {
        var variable = callee.Variable;
        assert(variable.Kind == "Func");
        return (variable.Name[0] in gcFunctions) ? "'" + variable.Name[0] + "'" : null;
    }
    assert(callee.Kind == "Drf");
    if (callee.Exp[0].Kind == "Fld") {
        var field = callee.Exp[0].Field;
        var csuName = field.FieldCSU.Type.Name;
        var fieldName = field.Name[0];
        return fieldCallCannotGC(csuName, fieldName) ? null : csuName + "." + fieldName;
    }
    assert(callee.Exp[0].Kind == "Var");
    var calleeName = callee.Exp[0].Variable.Name[0];
    return indirectCallCannotGC(functionName, calleeName) ? null : "*" + calleeName;
}

function computePredecessors(body)
{
    body.predecessors = [];
    if (!("PEdge" in body))
        return;
    for (var edge of body.PEdge) {
        var target = edge.Index[1];
        if (!(target in body.predecessors))
            body.predecessors[target] = [];
        body.predecessors[target].push(edge);
    }
}

function sameBlockId(id0, id1)
{
    if (id0.Kind != id1.Kind)
        return false;
    if (!sameVariable(id0.Variable, id1.Variable))
        return false;
    if (id0.Kind == "Loop" && id0.Loop != id1.Loop)
        return false;
    return true;
}

function variableUseFollowsGC(variable, worklist)
{
    while (worklist.length) {
        var entry = worklist.pop();
        var body = entry.body, ppoint = entry.ppoint;

        if (body.seen) {
            if (ppoint in body.seen) {
                var seenEntry = body.seen[ppoint];
                if (!entry.gcName || seenEntry.gcName)
                    continue;
            }
        } else {
            body.seen = [];
        }
        body.seen[ppoint] = {body:body, gcName:entry.gcName, why:entry.why};

        if (ppoint == body.Index[0]) {
            if (body.BlockId.Kind == "Loop") {
                // propagate to parents which enter the loop body.
                if ("BlockPPoint" in body) {
                    for (var parent of body.BlockPPoint) {
                        var found = false;
                        for (var xbody of functionBodies) {
                            if (sameBlockId(xbody.BlockId, parent.BlockId)) {
                                assert(!found);
                                found = true;
                                worklist.push({body:xbody, ppoint:parent.Index, gcName:entry.gcName, why:entry});
                            }
                        }
                        assert(found);
                    }
                }
            } else if (variable.Kind == "Arg" && entry.gcName) {
                return {gcName:entry.gcName, why:entry};
            }
        }

        if (!body.predecessors)
            computePredecessors(body);

        if (!(ppoint in body.predecessors))
            continue;

        for (var edge of body.predecessors[ppoint]) {
            if (edgeKillsVariable(edge, variable)) {
                if (entry.gcName)
                    return {gcName:entry.gcName, why:entry};
                continue;
            }

            var gcName = entry.gcName ? entry.gcName : edgeCanGC(edge);

            if (gcName && edgeUsesVariable(edge, variable))
                return {gcName:gcName, why:entry};

            if (edge.Kind == "Loop") {
                // propagate to exit points of the loop body, in addition to the
                // predecessor of the loop edge itself.
                var found = false;
                for (var xbody of functionBodies) {
                    if (sameBlockId(xbody.BlockId, edge.BlockId)) {
                        assert(!found);
                        found = true;
                        worklist.push({body:xbody, ppoint:xbody.Index[1], gcName:gcName, why:entry});
                    }
                }
                assert(found);
                break;
            }
            worklist.push({body:body, ppoint:edge.Index[0], gcName:gcName, why:entry});
        }
    }

    return null;
}

function variableLiveAcrossGC(variable)
{
    for (var body of functionBodies)
        body.seen = null;
    for (var body of functionBodies) {
        if (!("PEdge" in body))
            continue;
        for (var edge of body.PEdge) {
            if (edgeUsesVariable(edge, variable)) {
                var worklist = [{body:body, ppoint:edge.Index[0], gcName:null, why:null}];
                var call = variableUseFollowsGC(variable, worklist);
                if (call)
                    return call;
            }
        }
    }
    return null;
}

function computePrintedLines()
{
    assert(!system("xdbfind src_body.xdb '" + functionName + "' > tmp.txt"));
    var lines = snarf("tmp.txt").split('\n');

    for (var body of functionBodies)
    body.lines = [];

    // Distribute lines of output to the block they originate from.
    var currentBody = null;
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (/^block:/.test(line)) {
            if (match = /:(loop#\d+)/.exec(line)) {
                var loop = match[1];
                var found = false;
                for (var body of functionBodies) {
                    if (body.BlockId.Kind == "Loop" && body.BlockId.Loop == loop) {
                        assert(!found);
                        found = true;
                        currentBody = body;
                    }
                }
                assert(found);
            } else {
                for (var body of functionBodies) {
                    if (body.BlockId.Kind == "Function")
                        currentBody = body;
                }
            }
        }
        if (currentBody)
            currentBody.lines.push(line);
    }
}

function printEntryTrace(entry)
{
    if (!functionBodies[0].lines)
        computePrintedLines();

    while (entry) {
        var ppoint = entry.ppoint;

        // Find the point's source location.
        var lineText = null;
        for (var line of entry.body.lines) {
            if (match = /point (\d+): \"(.*?)\"/.exec(line)) {
                if (match[1] == ppoint) {
                    assert(!lineText);
                    lineText = match[2];
                }
            }
        }
        assert(lineText);

        var edgeText = null;
        if (entry.why && entry.why.body == entry.body) {
            // If the next point in the trace is in the same block, look for an edge between them.
            var next = entry.why.ppoint;
            for (var line of entry.body.lines) {
                if (match = /\((\d+),(\d+),/.exec(line)) {
                    if (match[1] == ppoint && match[2] == next) {
                        assert(!edgeText);
                        edgeText = line;
                    }
                }
            }
            assert(edgeText);
        } else {
            // Look for any outgoing edge from the chosen point.
            for (var line of entry.body.lines) {
                if (match = /\((\d+),/.exec(line)) {
                    if (match[1] == ppoint) {
                        edgeText = line;
                        break;
                    }
                }
            }
        }

        print("    " + lineText + (edgeText ? ": " + edgeText : ""));
        entry = entry.why;
    }
}

function processBodies()
{
    if (!("DefineVariable" in functionBodies[0]))
        return;
    for (var variable of functionBodies[0].DefineVariable) {
        if (!("Name" in variable.Variable))
            continue;
        var name = variable.Variable.Name[0];
        if (isRootedType(variable.Type)) {
            if (!variableLiveAcrossGC(variable.Variable))
                print("Function '" + functionName + "' with root " + name + " is not live across a GC call");
        } else if (isUnrootedType(variable.Type)) {
            var result = variableLiveAcrossGC(variable.Variable);
            if (result) {
                print("Function '" + functionName + "' with unrooted " + name + " is live across GC call " + result.gcName);
                printEntryTrace(result.why);
            }
        }
    }
}

assert(!system("xdbkeys src_body.xdb > tmp.txt"));
var functionNames = snarf("tmp.txt").split('\n');
assert(!functionNames[functionNames.length - 1]);
for (var nameIndex = 0; nameIndex < functionNames.length - 1; nameIndex++) {
    functionName = functionNames[nameIndex];
    printErr("Processing: " + nameIndex);
    assert(!system("xdbfind -json src_body.xdb '" + functionName + "' > tmp.txt"));
    var text = snarf("tmp.txt");
    functionBodies = JSON.parse(text);
    processBodies();
}

print("</pre></html>");
