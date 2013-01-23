/* -*- Mode: Javascript; tab-width: 4; indent-tabs-mode: nil; c-basic-offset: 4 -*- */

"use strict";

load('annotations.js');

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

function processCSU(csu, body)
{
    if (!("DataField" in body))
        return;
    for (var field of body.DataField) {
        var type = field.Field.Type;
        if (type.Kind == "Pointer") {
            var target = type.Type;
            if (target.Kind == "CSU")
                addNestedPointer(csu, target.Name);
        }
        if (type.Kind == "CSU") {
            // Ignore nesting in classes which are AutoGCRooters. We only consider
            // types with fields that may not be properly rooted.
            if (type.Name == "JS::AutoGCRooter")
                return;
            addNestedStructure(csu, type.Name);
        }
    }
}

function addNestedStructure(csu, inner)
{
    if (!(inner in structureParents))
        structureParents[inner] = [];
    structureParents[inner].push(csu);
}

function addNestedPointer(csu, inner)
{
    if (!(inner in pointerParents))
        pointerParents[inner] = [];
    pointerParents[inner].push(csu);
}

var structureParents = {};
var pointerParents = {};

assert(!system("xdbkeys src_comp.xdb > tmp.txt"));

var csuNames = snarf("tmp.txt").split('\n');
assert(!csuNames[csuNames.length - 1]);
for (var csuIndex = 0; csuIndex < csuNames.length - 1; csuIndex++) {
    var csu = csuNames[csuIndex];
    printErr("Processing: " + csuIndex);
    assert(!system("xdbfind -json src_comp.xdb '" + csu + "' > tmp.txt"));
    var text = snarf("tmp.txt");
    var json = JSON.parse(text);
    assert(json.length == 1);
    processCSU(csu, json[0]);
}

function addGCType(name)
{
    print("GCThing: " + name);
    if (name in structureParents) {
        for (var nested of structureParents[name])
            addGCType(nested);
    }
    if (name in pointerParents) {
        for (var nested of pointerParents[name])
            addGCPointer(nested);
    }
}

function addGCPointer(name)
{
    // Ignore types which are properly rooted.
    if (isRootedTypeName(name))
        return;
    print("GCPointer: " + name);
    if (name in structureParents) {
        for (var nested of structureParents[name])
            addGCPointer(nested);
    }
}

addGCType('js::ObjectImpl');
addGCType('JSString');
addGCType('js::Shape');
addGCType('js::BaseShape');
addGCType('JSScript');
addGCType('js::ion::IonCode');
addGCPointer('JS::Value');
