/**
 * Admin dashboard login: once the password is changed in the dashboard, the old one must stop working.
 * The env SUPER_ADMIN_PASSWORD used to stay a permanent second way in; it now only bootstraps the very
 * first super admin. Real NextAuth `authorize`, in-memory Prisma.
 *
 *   ZOHO_SMTP_HOST=127.0.0.1 ZOHO_SMTP_PORT=1 \
 *   NODE_OPTIONS="--require $PWD/scripts/payment-e2e/redirect-db.cjs" \
 *   npx tsx --tsconfig scripts/payment-e2e/tsconfig.json scripts/payment-e2e/auth-run.ts
 */
Object.assign(process.env, {
  NODE_ENV: 'test', NEXTAUTH_SECRET: 'x'.repeat(32),
  SUPER_ADMIN_EMAIL: 'admin@zicabella.com', SUPER_ADMIN_PASSWORD: 'OldPassword#1',
});
let failed = 0, passed = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
  if (ok) passed++; else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || detail === undefined ? '' : `\n      ${JSON.stringify(detail)}`}`);
};

async function main() {
  const { default: prisma, db } = await import('./memory-prisma');
  const bcrypt = (await import('bcryptjs')).default;
  const { authOptions } = await import('../../app/api/auth/[...nextauth]/options');
  const provider: any = (authOptions.providers as any[]).find((p) => p.id === 'admin-login' || p.options?.id === 'admin-login');
  const authorize = provider.options?.authorize || provider.authorize;
  const login = async (password: string, email = 'admin@zicabella.com') => {
    try { return await authorize({ email, password }, {} as any); } catch (e: any) { return { threw: e.message }; }
  };
  const ok = (r: any) => !!r && !r.threw && r.role === 'SUPER_ADMIN';

  console.log('\n— 1. first deploy: no account yet → the env password creates the super admin');
  check('env password logs in and seeds the account', ok(await login('OldPassword#1')));
  const seeded = (db.user || []).find((u: any) => u.email === 'admin@zicabella.com');
  check('the account now exists with a hashed password', !!seeded?.passwordHash && seeded.passwordHash !== 'OldPassword#1');

  console.log('\n— 2. the dashboard changes the password (as /api/admin/auth/change-password does)');
  await prisma.user.update({ where: { id: seeded.id }, data: { passwordHash: await bcrypt.hash('BrandNew#2', 12) } });
  check('the NEW password logs in', ok(await login('BrandNew#2')));
  check('the OLD password (still in the env) is refused', (await login('OldPassword#1')) === null);
  check('a wrong password is refused', (await login('nope')) === null);

  console.log('\n— 3. the env password is no second way in');
  await prisma.user.update({ where: { id: seeded.id }, data: { isActive: false } });
  check('a deactivated super admin cannot log in with the env password', (await login('OldPassword#1')) === null);
  check('…nor with the new password', (await login('BrandNew#2')) === null);
  await prisma.user.update({ where: { id: seeded.id }, data: { isActive: true, lockUntil: new Date(Date.now() + 600_000), failedLoginAttempts: 5 } });
  const locked = await login('OldPassword#1');
  check('a locked account is not unlocked by the env password', !!locked?.threw && /locked/i.test(locked.threw), locked);
  const lockedNew = await login('BrandNew#2');
  check('…and stays locked for the right password too', !!lockedNew?.threw && /locked/i.test(lockedNew.threw), lockedNew);
  await prisma.user.update({ where: { id: seeded.id }, data: { lockUntil: null, failedLoginAttempts: 0 } });

  console.log('\n— 4. database trouble');
  const realFind = (prisma as any).user.findUnique;
  (prisma as any).user.findUnique = async () => { throw new Error('db down'); };
  check('with the database unreachable the env password does NOT log in', (await login('OldPassword#1')) === null);
  (prisma as any).user.findUnique = realFind;

  console.log('\n— 5. other admins are unaffected');
  await prisma.user.create({ data: { email: 'ops@zicabella.com', passwordHash: await bcrypt.hash('OpsPass#3', 12), name: 'Ops', role: 'ADMIN', isActive: true } });
  const ops = await login('OpsPass#3', 'ops@zicabella.com');
  check('another admin logs in with their own password', !!ops && !ops.threw && ops.email === 'ops@zicabella.com', ops);
  check('and not with the super admin env password', (await login('OldPassword#1', 'ops@zicabella.com')) === null);

  console.log(`\n${failed === 0 ? 'ALL PASSED' : 'FAILURES'} — ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
