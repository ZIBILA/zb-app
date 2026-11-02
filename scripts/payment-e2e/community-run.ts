/**
 * Community "Publish your look": a customer's photo reaches Dashboard -> Community as a pending submission,
 * becomes public only when approved, and the open endpoints that used to accept anything now need a login.
 * Real routes + real app-token auth, in-memory Prisma, storage (Supabase) faked at the HTTP layer.
 *
 *   NODE_OPTIONS="--require $PWD/scripts/payment-e2e/redirect-db.cjs" \
 *   npx tsx --tsconfig scripts/payment-e2e/tsconfig.community.json scripts/payment-e2e/community-run.ts
 */
Object.assign(process.env, {
  NODE_ENV: 'test', NEXTAUTH_SECRET: 'x'.repeat(40),
  NEXT_PUBLIC_SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'svc_key',
});
const stored: string[] = [];
(globalThis as any).fetch = async (url: string, opt: any = {}) => {
  const u = String(url);
  const json = (status: number, body: any) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body), headers: new Map() });
  if (u.includes('/storage/v1/object/store-assets/uploads/') && opt.method === 'POST') { stored.push(u); return json(200, { Key: 'ok' }); }
  return json(200, {});
};

let failed = 0, passed = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
  if (ok) passed++; else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || detail === undefined ? '' : `\n      ${JSON.stringify(detail)}`}`);
};
const eq = (label: string, got: unknown, want: unknown) => check(label, JSON.stringify(got) === JSON.stringify(want), { got, want });

// a tiny valid JPEG header is enough for the magic-byte check
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]), Buffer.alloc(200, 1)]);

async function main() {
  const { db, default: prisma } = await import('./memory-prisma');
  const { signAccessToken } = await import('../../lib/appAuth');
  const { state } = await import('../meta-regression/mocks');
  const upload = await import('../../app/api/community/upload/route');
  const submit = await import('../../app/api/community/submit/route');
  const legacy = await import('../../app/api/featured-users/route');
  const legacySubmit = await import('../../app/api/featured-users/submit/route');
  const adminOne = await import('../../app/api/admin/featured-users/[id]/route');
  const adminList = await import('../../app/api/admin/featured-users/route');

  await prisma.customer.create({ data: { id: 'cust_c1', shopId: 's', shopifyId: 'G1', name: 'Aarav Mehta', email: 'aarav@example.com', phone: '+919811122244', tokenVersion: 0 } });
  await prisma.customer.create({ data: { id: 'cust_c3', shopId: 's', shopifyId: 'G3', name: 'Kabir Rao', email: 'kabir@example.com', tokenVersion: 0 } });
  await prisma.customer.create({ data: { id: 'cust_c2', shopId: 's', shopifyId: 'G2', name: 'Riya Kapoor', email: 'riya@example.com', tokenVersion: 0 } });
  const tok = (id: string) => `Bearer ${signAccessToken({ customerId: id, tokenVersion: 0 })}`;
  const A = tok('cust_c1');

  const post = (route: any, url: string, body: any, auth?: string) => route.POST(new Request(url, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', 'x-forwarded-for': '49.36.10.20', ...(auth ? { authorization: auth } : {}) } }));
  const up = (auth: string | undefined, bytes: Buffer = JPEG, name = 'look.jpg', type = 'image/jpeg') => {
    const fd = new FormData(); fd.append('file', new File([new Uint8Array(bytes)], name, { type }));
    return upload.POST(new Request('https://zicabella.com/api/community/upload', { method: 'POST', body: fd, headers: { 'x-forwarded-for': '49.36.10.21', ...(auth ? { authorization: auth } : {}) } }));
  };
  const publicList = async () => ((await (await legacy.GET(new Request('https://zicabella.com/api/featured-users'))).json()) as any).users as any[];
  const rows = () => (db.featuredUser || []) as any[];

  console.log('\n— 1. no login → nothing is accepted');
  eq('1a: upload without login', (await up(undefined)).status, 401);
  eq('1b: submit without login', (await post(submit, 'https://zicabella.com/api/community/submit', { imageUrl: 'x' })).status, 401);
  eq('1c: the old open /api/featured-users POST now needs a login', (await post(legacy, 'https://zicabella.com/api/featured-users', { name: 'x', email: 'x@x.com', imageUrl: 'https://evil.example/a.jpg' })).status, 401);
  eq('1d: the old open /api/featured-users/submit now needs a login', (await post(legacySubmit, 'https://zicabella.com/api/featured-users/submit', { name: 'x', email: 'x@x.com', imageUrl: 'https://evil.example/a.jpg' })).status, 401);
  eq('1e: a token for a customer that does not exist is refused', (await up(tok('ghost'))).status, 401);
  eq('1f: nothing was stored or created', [stored.length, rows().length], [0, 0]);

  console.log('\n— 2. the app uploads a photo, then submits it');
  const u1 = await up(A); const u1j: any = await u1.json();
  check('2a: upload works with the app token and returns our own storage URL', u1.status === 200 && /^https:\/\/proj\.supabase\.co\/storage\/v1\/object\/public\/store-assets\/uploads\//.test(u1j.url), u1j);
  eq('2b: not a photo (text file named .jpg) → refused', (await up(A, Buffer.from('hello world, not an image at all')))?.status, 400);
  eq('2c: wrong file type → refused', (await up(A, JPEG, 'virus.exe', 'application/octet-stream')).status, 400);
  const s1 = await post(submit, 'https://zicabella.com/api/community/submit', { imageUrl: u1j.url, styleDescription: 'Oversized denim, black tee', instagramUrl: 'https://instagram.com/aarav', name: 'Hacker', email: 'hacker@x.com', status: 'APPROVED', isTopFeatured: true }, A);
  const s1j: any = await s1.json();
  eq('2d: submit is accepted as PENDING', [s1.status, s1j.submission?.status], [200, 'PENDING']);
  const row = rows().find(r => r.id === s1j.submission?.id);
  eq('2e: name and email come from the account, not from the request', [row?.name, row?.email], ['Aarav Mehta', 'aarav@example.com']);
  eq('2f: status and "top featured" cannot be chosen by the customer', [row?.status, row?.isTopFeatured], ['PENDING', false]);
  check('2g: the admin list (Dashboard → Community) shows it with all its details', await (async () => {
    const list: any = await (await adminList.GET()).json();
    const r = list.users.find((x: any) => x.id === row?.id);
    return !!r && r.status === 'PENDING' && r.imageUrl === u1j.url && r.styleDescription === 'Oversized denim, black tee' && r.instagramUrl === 'https://instagram.com/aarav';
  })());
  check('2h: PENDING is NOT public', !(await publicList()).some(u => u.id === row?.id));

  console.log('\n— 3. only our own uploaded photos, clean details');
  const bad = async (imageUrl: any, extra: any = {}) => (await post(submit, 'https://zicabella.com/api/community/submit', { imageUrl, ...extra }, A)).status;
  eq('3a: a link to another site is refused', await bad('https://evil.example/a.jpg'), 400);
  eq('3b: a data: image is refused', await bad('data:image/png;base64,AAAA'), 400);
  eq('3c: an http (not https) storage link is refused', await bad(u1j.url.replace('https://', 'http://')), 400);
  eq('3d: another folder of our storage is refused', await bad('https://proj.supabase.co/storage/v1/object/public/store-assets/social-sharing/x.jpg'), 400);
  eq('3e: a look-alike host is refused', await bad('https://proj.supabase.co.evil.example/storage/v1/object/public/store-assets/uploads/x.jpg'), 400);
  eq('3f: no photo at all is refused', await bad(''), 400);
  const u2: any = await (await up(A)).json();
  eq('3g: a description over 500 characters is refused', await bad(u2.url, { styleDescription: 'x'.repeat(501) }), 400);
  eq('3h: an Instagram link that is not instagram.com is refused', await bad(u2.url, { instagramUrl: 'https://evil.example/aarav' }), 400);
  eq('3i: nothing was created by the refused attempts', rows().length, 1);

  console.log('\n— 4. duplicates and limits');
  const dup: any = await (await post(submit, 'https://zicabella.com/api/community/submit', { imageUrl: u1j.url }, A)).json();
  eq('4a: the same photo submitted twice is one submission', [dup.submission?.id === row?.id, rows().filter(r => r.email === 'aarav@example.com').length], [true, 1]);
  const K = tok('cust_c3');
  for (let i = 0; i < 3; i++) { const u: any = await (await up(K)).json(); await post(submit, 'https://zicabella.com/api/community/submit', { imageUrl: u.url }, K); }
  eq('4b: three looks waiting for review', rows().filter(r => r.status === 'PENDING' && r.email === 'kabir@example.com').length, 3);
  const u4: any = await (await up(K)).json();
  eq('4c: a fourth pending look is refused until the others are reviewed', (await post(submit, 'https://zicabella.com/api/community/submit', { imageUrl: u4.url }, K)).status, 429);
  const other: any = await (await up(tok('cust_c2'))).json();
  eq('4d: another customer is not affected by that limit', (await post(submit, 'https://zicabella.com/api/community/submit', { imageUrl: other.url }, tok('cust_c2'))).status, 200);

  console.log('\n— 5. website customers (logged-in session instead of an app token)');
  state.session = { user: { id: 'cust_c2', email: 'riya@example.com' } };
  const w: any = await (await up(undefined)).json();
  const ws = await post(submit, 'https://zicabella.com/api/community/submit', { imageUrl: w.url, styleDescription: 'Cargos' });
  eq('5a: a website session can upload and submit', [w.success, ws.status], [true, 200]);
  state.session = { user: { id: 'admin_user_1', role: 'ADMIN' } };
  eq('5b: a session that is not a customer (an admin id) is refused', (await up(undefined)).status, 401);
  state.session = null;

  console.log('\n— 6. admin approves / rejects → public board');
  const pendingId = row!.id;
  const patch = (id: string, body: any) => adminOne.PATCH(new Request('https://zicabella.com/x', { method: 'PATCH', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }), { params: { id } });
  const ap = await patch(pendingId, { status: 'APPROVED' });
  eq('6a: approve works', ap.status, 200);
  check('6b: the approved look is now public', (await publicList()).some(u => u.id === pendingId));
  const second = rows().find(r => r.status === 'PENDING' && r.email === 'kabir@example.com')!;
  await patch(second.id, { status: 'REJECTED' });
  check('6c: a rejected look is not public', !(await publicList()).some(u => u.id === second.id));
  check('6d: a look still pending is not public', (await publicList()).every(u => u.status === 'APPROVED'));
  await patch(pendingId, { status: 'REJECTED' });
  check('6e: rejecting an approved look takes it off the board', !(await publicList()).some(u => u.id === pendingId));

  console.log('\n— 7. storage trouble and abuse');
  const savedUrl = process.env.NEXT_PUBLIC_SUPABASE_URL; delete process.env.NEXT_PUBLIC_SUPABASE_URL; const savedKey = process.env.SUPABASE_SERVICE_ROLE_KEY; delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  eq('7a: no storage configured → a clear 503, never a giant base64 string in the database', (await up(A)).status, 503);
  process.env.NEXT_PUBLIC_SUPABASE_URL = savedUrl!; process.env.SUPABASE_SERVICE_ROLE_KEY = savedKey!;
  let last = 200; for (let i = 0; i < 14; i++) last = (await up(tok('cust_c2'))).status;
  eq('7b: uploads are rate-limited per customer', last, 429);

  console.log(`\n${failed === 0 ? 'ALL PASSED' : 'FAILURES'} — ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
