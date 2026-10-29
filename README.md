> [!IMPORTANT]
> **DATABASE SECURITY NOTICE**: Database passwords previously committed in repository history have been compromised and MUST be rotated in Supabase (Settings → Database → Reset Database Password). Set all connection credentials strictly via `DATABASE_URL` (Supabase Pooled connection, port 6543) and `DIRECT_URL` (Supabase Direct connection, port 5432) in environment variables. Do NOT commit database passwords or connection strings to source control.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Razorpay — Production Deployment Checklist

1. **Switch keys**: Replace `rzp_test_` with `rzp_live_` in both `RAZORPAY_KEY_ID` and `EXPO_PUBLIC_RAZORPAY_KEY_ID`
2. **Set webhook URL**: Razorpay Dashboard → Webhooks → `https://zicabella.com/api/webhooks/razorpay` (`/api/razorpay/webhook` is an alias of the same handler)
3. **Enable events**: `payment.captured`, `order.paid`, `payment.authorized`, `payment.failed`, `refund.created`, `refund.processed`, `refund.failed`
4. **Set `RAZORPAY_WEBHOOK_SECRET`**: Copy from Dashboard → Webhooks → Secret
5. **Test ₹1 live transaction**: Create a real ₹1 order to validate the full flow before go-live
6. **Verify DB connectivity**: Ensure `prisma db push` has been run on production
7. **Check CORS**: Confirm `/api/razorpay/*` routes return proper CORS headers
8. **Rate limiting**: Create-order is limited to 10 requests/IP/minute

See `docs/razorpay-testing.md` for full testing and debugging guide.
