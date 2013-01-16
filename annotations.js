/* -*- Mode: Javascript; tab-width: 4; indent-tabs-mode: nil; c-basic-offset: 4 -*- */

function indirectCallCannotGC(caller, name)
{
    if (name == "mallocSizeOf")
        return true;

    return false;
}

function fieldCallCannotGC(csu, field)
{
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
        "JSLocaleCallbacks"
    ];

    for (var i = 0; i < ignoreClasses.length; i++) {
        if (csu == ignoreClasses[i])
            return true;
    }

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
        }
    }

    return false;
}
