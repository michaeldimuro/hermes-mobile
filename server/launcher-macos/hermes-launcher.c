// Hermes.app launcher: runs a command as its child and stays its parent.
//
// macOS charges privacy prompts (Full Disk Access, "data from other apps", ...) to the *responsible*
// process, which children inherit. Hermes runs on an ad-hoc-signed Python the Full Disk Access picker
// won't accept, so launchd starts Hermes through this app instead: grant Hermes.app once and Hermes, its
// bots and every script they run are covered. It must spawn, not exec: after exec the process would be
// Python again and the prompts would come back.
#include <errno.h>
#include <signal.h>
#include <spawn.h>
#include <stdio.h>
#include <sys/wait.h>

extern char **environ;
static pid_t child = -1;

static void forward(int sig) {
  if (child > 0) kill(child, sig);
}

int main(int argc, char **argv) {
  if (argc < 2) {
    fprintf(stderr, "usage: Hermes <command> [args...]\n");
    return 64;
  }
  struct sigaction sa = {0};
  sa.sa_handler = forward;
  sigaction(SIGTERM, &sa, NULL);
  sigaction(SIGINT, &sa, NULL);
  sigaction(SIGHUP, &sa, NULL);

  int err = posix_spawn(&child, argv[1], NULL, NULL, argv + 1, environ);
  if (err != 0) {
    errno = err;
    perror(argv[1]);
    return 127;
  }
  int status = 0;
  while (waitpid(child, &status, 0) < 0) {
    if (errno != EINTR) return 1;
  }
  if (WIFEXITED(status)) return WEXITSTATUS(status);
  if (WIFSIGNALED(status)) {
    signal(WTERMSIG(status), SIG_DFL);
    raise(WTERMSIG(status));
  }
  return 1;
}
