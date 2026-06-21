// Test double: a bridge that never finishes — it ignores its args, writes no
// output, and keeps the process alive — to exercise the server's timeout path
// (the server must SIGKILL it and fail the request, not hang forever).
setInterval(() => {}, 1_000_000);
