export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { installConciseConsole } = await import('./lib/log-format');
    installConciseConsole();
    const { startBackgroundJobs } = await import('./lib/background-jobs');
    startBackgroundJobs();
    // Production only: load the catalogue the app's home screen reads first, so nobody waits for the first build.
    if (process.env.NODE_ENV === 'production' && process.env.DISABLE_INTERNAL_JOBS !== 'true') {
      const { warmAppCatalog } = await import('./lib/app-products-list');
      setTimeout(() => { warmAppCatalog(); }, 15_000);
    }
  }
}
