/* -*- Mode: Javascript; tab-width: 4; indent-tabs-mode: nil; c-basic-offset: 4 -*- */

"use strict";

function indirectCallCannotGC(caller, name)
{
    if (name == "mallocSizeOf")
        return true;

    return false;
}

// classes to ignore indirect calls on.
var ignoreClasses = [
    "js::ion::MNode",
    "js::ion::MDefinition",
    "js::ion::MInstruction",
    "js::ion::MControlInstruction",
    "js::ion::LInstruction",
    "js::ion::OutOfLineCode",
    "JSTracer",
    "SprintfStateStr",
    "js::InterpreterFrames::InterruptEnablerBase",
    "JSLocaleCallbacks",
    "js::MatchPairs",
    "js::types::TypeConstraint"
];

function fieldCallCannotGC(csu, field)
{
    for (var i = 0; i < ignoreClasses.length; i++) {
        if (csu == ignoreClasses[i])
            return true;
    }
    if (csu == "js::Class" && field == "trace")
        return true;
    return false;
}

function ignoreEdgeUse(edge, variable)
{
    // Functions which should not be treated as using variable.
    if (edge.Kind == "Call") {
        var callee = edge.Exp[0];
        if (callee.Kind == "Var") {
            var name = callee.Variable.Name[0];
            if (/~Anchor/.test(name))
                return true;
            if (/::Unrooted\(\)/.test(name))
                return true;
            if (/~DebugOnly/.test(name))
                return true;
        }
    }

    return false;
}

var ignoreFunctions = [
    "js_ReportOutOfMemory",
    "js_ReportAllocationOverflow",
    "js::DeflateStringToBuffer",
    "js::InflateStringToBuffer",
    "js::InflateUTF8StringToBuffer",
    "js::types::TypeObject::clearNewScript",
    "analyzeTypesBytecode"
];

function ignoreGCFunction(fun)
{
    for (var i = 0; i < ignoreFunctions.length; i++) {
        if (fun.indexOf(ignoreFunctions[i]) >= 0)
            return true;
    }
    return false;
}

function isRootedTypeName(name)
{
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
