
"use strict";

print("<html><pre>");
print("Time: " + new Date);

function assert(x)
{
    if (!x)
	throw "assertion failed: " + (Error().stack);
}

function indirectCallCannotGC(caller, name)
{
    if (name == "mallocSizeOf")
	return true;

    if (caller == "void js_ReportOutOfMemory(JSContext*)")
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

function addGCFunction(caller, reason)
{
    if (!(caller in gcFunctions))
	gcFunctions[caller] = reason;
}

function addCallEdge(caller, callee)
{
    if (!(callee in callerGraph))
	callerGraph[callee] = [];
    callerGraph[callee].push(caller);
}

var callerGraph = {};
var gcFunctions = {};

if (typeof arguments[0] != 'string')
    throw "Usage: computeCallgraph.js <callgraph.txt>";

var textLines = snarf(arguments[0]).split('\n');
for (var line of textLines) {
    var match;
    if (match = /IndirectEdge: CALLER (.*?) VARIABLE ([^\,]*)/.exec(line)) {
	var caller = match[1];
	var name = match[2];
	if (!indirectCallCannotGC(caller, name))
	    addGCFunction(caller, "IndirectCall: " + name);
    } else if (match = /FieldEdge: CALLER (.*?) CLASS (.*?) FIELD (.*)/.exec(line)) {
	var caller = match[1];
	var csu = match[2];
	var field = match[3];
	if (!fieldCallCannotGC(csu, field))
	    addGCFunction(caller, "FieldCall: " + csu + "." + field);
    } else if (match = /DirectEdge: CALLER (.*?) CALLEE (.*)/.exec(line)) {
	var caller = match[1];
	var callee = match[2];
	addCallEdge(caller, callee);
    }
}

var gcName = 'void js::GC(JSRuntime*, js::JSGCInvocationKind, js::gcreason::Reason)';
assert(gcName in callerGraph);
addGCFunction(gcName, "<GC>");

var worklist = [];
for (var name in gcFunctions)
    worklist.push(name);

while (worklist.length) {
    name = worklist.pop();
    assert(name in gcFunctions);
    if (!(name in callerGraph))
	continue;
    for (var caller of callerGraph[name]) {
	if (caller in gcFunctions)
	    continue;
	gcFunctions[caller] = name;
	worklist.push(caller);
    }
}

var count = 0;
for (var name in gcFunctions) {
    print("");
    print("GC Function: " + name);
    do {
	name = gcFunctions[name];
	print("    " + name);
    } while (name in gcFunctions);
}

print("</pre></html>");
