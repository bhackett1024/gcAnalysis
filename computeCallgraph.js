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

var memoized = {};
var memoizedCount = 0;

function memo(name)
{
    if (!(name in memoized)) {
        memoizedCount++;
        memoized[name] = "" + memoizedCount;
        print("#" + memoizedCount + " " + name);
    }
    return memoized[name];
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
        var prologue = suppressText + memo(caller) + " ";
        if (callee.Kind == "Var") {
            assert(callee.Variable.Kind == "Func");
            var name = callee.Variable.Name[0];
            print("D " + prologue + memo(name));
            var otherName = otherDestructorName(name);
            if (otherName)
                print("D " + prologue + memo(otherName));
        } else {
            assert(callee.Kind == "Drf");
            if (callee.Exp[0].Kind == "Fld") {
                var field = callee.Exp[0].Field;
                if ("FieldInstanceFunction" in field) {
                    // virtual function call.
                    var functions = findVirtualFunctions(field.FieldCSU.Type.Name, field.Name[0]);
                    for (var name of functions)
                        print("D " + prologue + memo(name));
                } else {
                    // indirect call through a field.
                    print("F " + prologue +
                          "CLASS " + field.FieldCSU.Type.Name +
                          " FIELD " + field.Name[0]);
                }
            } else if (callee.Exp[0].Kind == "Var") {
                // indirect call through a variable.
                assert(callee.Exp[0].Kind == "Var");
                print("I " + prologue +
                      "VARIABLE " + callee.Exp[0].Variable.Name[0]);
            } else {
                // unknown call target.
                print("I " + prologue + "VARIABLE UNKNOWN");
            }
        }
    }
}

var callgraph = {};

var xdb = xdbLibrary();
xdb.open("src_comp.xdb");

var minStream = xdb.min_data_stream();
var maxStream = xdb.max_data_stream();

for (var csuIndex = minStream; csuIndex <= maxStream; csuIndex++) {
    var csu = xdb.read_key(csuIndex);
    printErr("Processing CSU: " + csuIndex);
    var data = xdb.read_entry(csu);
    var json = JSON.parse(data.readString());
    processCSU(csu.readString(), json[0]);

    xdb.free_string(csu);
    xdb.free_string(data);
}

xdb.open("src_body.xdb");

var minStream = xdb.min_data_stream();
var maxStream = xdb.max_data_stream();

for (var nameIndex = minStream; nameIndex <= maxStream; nameIndex++) {
    var name = xdb.read_key(nameIndex);
    printErr("Processing: " + nameIndex);
    var data = xdb.read_entry(name);
    functionBodies = JSON.parse(data.readString());
    for (var body of functionBodies)
        body.suppressed = [];
    for (var body of functionBodies)
        computeSuppressedPoints(body);
    for (var body of functionBodies)
        processBody(name.readString(), body);

    xdb.free_string(name);
    xdb.free_string(data);
}
