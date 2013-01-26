
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

function sameVariable(var0, var1)
{
    assert("Name" in var0 || var0.Kind == "This" || var0.Kind == "Return");
    return "Name" in var0 && var0.Name[0] == var1.Name[0];
}
