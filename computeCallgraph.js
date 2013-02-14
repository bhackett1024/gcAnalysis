/* -*- Mode: Javascript; tab-width: 4; indent-tabs-mode: nil; c-basic-offset: 4 -*- */

"use strict";

load('utility.js');
load('annotations.js');

var functionBodies;

function suppressAllPoints(id)
{
    var body = null;
    for (var xbody of functionBodies) {
        if (sameBlockId(xbody.BlockId, id)) {
            assert(!body);
            body = xbody;
        }
    }
    assert(body);

    if (!("PEdge" in body))
        return;
    for (var edge of body.PEdge) {
        body.suppressed[edge.Index[0]] = true;
        if (edge.Kind == "Loop")
            suppressAllPoints(edge.BlockId);
    }
}

function isMatchingDestructor(constructor, edge)
{
    if (edge.Kind != "Call")
        return false;
    var callee = edge.Exp[0];
    if (callee.Kind != "Var")
        return false;
    var variable = callee.Variable;
    assert(variable.Kind == "Func");
    if (!/::~/.test(variable.Name[0]))
        return false;

    var constructExp = constructor.PEdgeCallInstance.Exp;
    assert(constructExp.Kind == "Var");

    var destructExp = edge.PEdgeCallInstance.Exp;
    if (destructExp.Kind != "Var")
        return false;

    return sameVariable(constructExp.Variable, destructExp.Variable);
}

var subclasses = {};
var classFunctions = {};

function processCSU(csuName, csu)
{
    if (!("FunctionField" in csu))
        return;
    for (var field of csu.FunctionField) {
        if (1 in field.Field) {
            var superclass = field.Field[1].Type.Name;
            var subclass = field.Field[1].FieldCSU.Type.Name;
            assert(subclass == csuName);
            if (!(superclass in subclasses))
                subclasses[superclass] = [];
            var found = false;
            for (var sub of subclasses[superclass]) {
                if (sub == subclass)
                    found = true;
            }
            if (!found)
                subclasses[superclass].push(subclass);
        }
        if ("Variable" in field) {
            var name = field.Variable.Name[0];
            var key = csuName + ":" + field.Field[0].Name[0];
            classFunctions[key] = name;
        }
    }
}

function findVirtualFunctions(csu, field)
{
    var functions = [];
    var worklist = [csu];

    while (worklist.length) {
        var csu = worklist.pop();
        var key = csu + ":" + field;

        if (key in classFunctions)
            functions.push(classFunctions[key]);

        if (csu in subclasses) {
            for (var subclass of subclasses[csu])
                worklist.push(subclass);
        }
    }

    return functions;
}

// Compute the points within a function body where GC is suppressed.
function computeSuppressedPoints(body)
{
    var successors = [];

    if (!("PEdge" in body))
        return;
    for (var edge of body.PEdge) {
        var source = edge.Index[0];
        if (!(source in successors))
            successors[source] = [];
        successors[source].push(edge);
    }

    for (var edge of body.PEdge) {
        if (edge.Kind != "Call")
            continue;
        var callee = edge.Exp[0];
        if (callee.Kind != "Var")
            continue;
        var variable = callee.Variable;
        assert(variable.Kind == "Func");
        if (!isSuppressConstructor(variable.Name[0]))
            continue;
        if (edge.PEdgeCallInstance.Exp.Kind != "Var")
            continue;

        var seen = [];
        var worklist = [edge.Index[1]];
        while (worklist.length) {
            var point = worklist.pop();
            if (point in seen)
                continue;
            seen[point] = true;
            body.suppressed[point] = true;
            if (!(point in successors))
                continue;
            for (var nedge of successors[point]) {
                if (isMatchingDestructor(edge, nedge))
                    continue;
                if (nedge.Kind == "Loop")
                    suppressAllPoints(nedge.BlockId);
                worklist.push(nedge.Index[1]);
            }
        }
    }

    return [];
}

function processBody(caller, body)
{
    if (!('PEdge' in body))
        return;
    for (var edge of body.PEdge) {
        if (edge.Kind != "Call")
            continue;
        var callee = edge.Exp[0];
        var suppressText = (edge.Index[0] in body.suppressed) ? "SUPPRESS_GC " : "";
        var prologue = suppressText + "CALLER " + caller;
        if (callee.Kind == "Var") {
            assert(callee.Variable.Kind == "Func");
            var name = callee.Variable.Name[0];
            print("DirectEdge: " + prologue + " CALLEE " + name);
            var otherName = otherDestructorName(name);
            if (otherName)
                print("DirectEdge: " + prologue + " CALLEE " + otherName);
        } else {
            assert(callee.Kind == "Drf");
            if (callee.Exp[0].Kind == "Fld") {
                var field = callee.Exp[0].Field;
                if ("FieldInstanceFunction" in field) {
                    // virtual function call.
                    var functions = findVirtualFunctions(field.FieldCSU.Type.Name, field.Name[0]);
                    for (var name of functions)
                        print("DirectEdge: " + prologue + " CALLEE " + name);
                } else {
                    // indirect call through a field.
                    print("FieldEdge: " + prologue +
                          " CLASS " + field.FieldCSU.Type.Name +
                          " FIELD " + field.Name[0]);
                }
            } else if (callee.Exp[0].Kind == "Var") {
                // indirect call through a variable.
                assert(callee.Exp[0].Kind == "Var");
                print("IndirectEdge: " + prologue +
                      " VARIABLE " + callee.Exp[0].Variable.Name[0]);
            } else {
                // unknown call target.
                print("IndirectEdge: " + prologue + " VARIABLE UNKNOWN");
            }
        }
    }
}

var callgraph = {};

assert(!system("xdbkeys src_comp.xdb > tmp.txt"));
var csuNames = snarf("tmp.txt").split('\n');
assert(!csuNames[csuNames.length - 1]);
for (var csuIndex = 0; csuIndex < csuNames.length - 1; csuIndex++) {
    var csu = csuNames[csuIndex];
    printErr("Processing CSU: " + csuIndex);
    assert(!system("xdbfind -json src_comp.xdb '" + csu + "' > tmp.txt"));
    var text = snarf("tmp.txt");
    var json = JSON.parse(text);
    processCSU(csu, json[0]);
}

assert(!system("xdbkeys src_body.xdb > tmp.txt"));
var functionNames = snarf("tmp.txt").split('\n');

assert(!functionNames[functionNames.length - 1]);
for (var nameIndex = 0; nameIndex < functionNames.length - 1; nameIndex++) {
    var name = functionNames[nameIndex];
    printErr("Processing: " + nameIndex);
    assert(!system("xdbfind -json src_body.xdb '" + name + "' > tmp.txt"));
    var text = snarf("tmp.txt");
    functionBodies = JSON.parse(text);
    for (var body of functionBodies)
        body.suppressed = [];
    for (var body of functionBodies)
        computeSuppressedPoints(body);
    for (var body of functionBodies)
        processBody(name, body);
}
