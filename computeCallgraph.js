/* -*- Mode: Javascript; tab-width: 4; indent-tabs-mode: nil; c-basic-offset: 4 -*- */

"use strict";

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

function processBody(caller, body)
{
    if (!('PEdge' in body))
        return;
    for (var edge of body.PEdge) {
        if (edge.Kind != "Call")
            continue;
        var callee = edge.Exp[0];
        if (callee.Kind == "Var") {
            var variable = callee.Variable;
            assert(variable.Kind == "Func");
            print("DirectEdge: CALLER " + caller +
                  " CALLEE " + variable.Name[0]);
        } else {
            assert(callee.Kind == "Drf");
            if (callee.Exp[0].Kind == "Fld") {
                var field = callee.Exp[0].Field;
                print("FieldEdge: CALLER " + caller +
                      " CLASS " + field.FieldCSU.Type.Name +
                      " FIELD " + field.Name[0]);
            } else {
                assert(callee.Exp[0].Kind == "Var");
                print("IndirectEdge: CALLER " + caller +
                      " VARIABLE " + callee.Exp[0].Variable.Name[0]);
            }
        }
    }
}

assert(!system("xdbkeys src_body.xdb > tmp.txt"));

var callgraph = {};

var functionNames = snarf("tmp.txt").split('\n');
assert(!functionNames[functionNames.length - 1]);
for (var nameIndex = 0; nameIndex < functionNames.length - 1; nameIndex++) {
    var name = functionNames[nameIndex];
    print("Processing: " + nameIndex);
    assert(!system("xdbfind -json src_body.xdb '" + name + "' > tmp.txt"));
    var text = snarf("tmp.txt");
    var json = JSON.parse(text);
    for (var body of json)
        processBody(name, body);
}
