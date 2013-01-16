
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
