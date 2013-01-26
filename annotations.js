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
    "js::ion::MInstructionVisitor",
    "js::ion::LInstructionVisitor",
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

function ignoreGCFunction(fun)
{
    // XXX modify refillFreeList<NoGC> to not need data flow analysis to understand it cannot GC.
    if (/refillFreeList/.test(fun) && /\(js::AllowGC\)0u/.test(fun))
        return true;
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

function isSuppressConstructor(name)
{
    return /::AutoSuppressGC/.test(name)
        || /::AutoEnterAnalysis/.test(name);
}
