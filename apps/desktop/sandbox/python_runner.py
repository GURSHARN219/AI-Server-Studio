"""
Minimal Python sandbox runner.
Reads code from stdin, executes with restricted builtins, writes JSON result to stdout.
Launched as a subprocess with a timeout by the MCP daemon.
"""
import sys
import json
import io
import traceback

BLOCKED = {"open", "exec", "eval", "__import__", "compile", "breakpoint",
           "input", "memoryview", "staticmethod", "classmethod"}

safe_builtins = {k: v for k, v in __builtins__.items()
                 if k not in BLOCKED} if isinstance(__builtins__, dict) else {}

# Minimal safe set
safe_builtins.update({
    "print": print, "len": len, "range": range, "enumerate": enumerate,
    "zip": zip, "map": map, "filter": filter, "sorted": sorted, "reversed": reversed,
    "list": list, "dict": dict, "set": set, "tuple": tuple, "str": str,
    "int": int, "float": float, "bool": bool, "abs": abs, "round": round,
    "min": min, "max": max, "sum": sum, "isinstance": isinstance, "type": type,
    "repr": repr, "format": format, "hasattr": hasattr, "getattr": getattr,
    "Exception": Exception, "ValueError": ValueError, "TypeError": TypeError,
    "KeyError": KeyError, "IndexError": IndexError,
})

code = sys.stdin.read()
stdout_capture = io.StringIO()
stderr_capture = io.StringIO()
result = None
error = None

try:
    import sys as _sys
    old_stdout, old_stderr = _sys.stdout, _sys.stderr
    _sys.stdout = stdout_capture
    _sys.stderr = stderr_capture
    exec(compile(code, "<sandbox>", "exec"), {"__builtins__": safe_builtins})
    _sys.stdout = old_stdout
    _sys.stderr = old_stderr
except Exception as e:
    _sys.stdout = old_stdout
    _sys.stderr = old_stderr
    error = traceback.format_exc()

print(json.dumps({
    "stdout": stdout_capture.getvalue(),
    "stderr": stderr_capture.getvalue(),
    "result": result,
    "logs": stdout_capture.getvalue().splitlines(),
    "error": error,
}))
