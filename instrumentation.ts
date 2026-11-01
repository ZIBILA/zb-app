export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { installConciseConsole } = await import('./lib/log-format');
    installConciseConsole();
  }
}
