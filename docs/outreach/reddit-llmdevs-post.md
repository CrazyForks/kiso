I’m Vince, the creator of Kiso, an MIT-licensed open-source agent runtime. I built it around a failure case the usual request/result loop hides: a tool starts, but the runtime crashes before it records a receipt.

Kiso writes a durable tool_execution_started event before calling a tool, then records a success or failure receipt. On resume, started-without-receipt is the unknown outcome: it pauses until a person chooses to rerun or abandon the operation. A complete failure receipt remains a known failure. If the tool isn’t known to be idempotent, the result warns that partial effects may have happened; any retry is a new call that passes the permission gate again.

This doesn’t make arbitrary remote effects exactly-once. It makes uncertainty explicit instead of silently replaying a possibly completed action.

I’d value criticism of this boundary: for a tool that may have acted before the client lost its response, would you use idempotency keys, operator resolution, or another recovery model?

Repo (MIT): https://github.com/vincemakes/kiso
Current semantics: https://github.com/vincemakes/kiso/blob/main/docs/adrs/0038-uncertainty-belongs-to-the-crash-window.md
