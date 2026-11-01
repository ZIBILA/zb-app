/**
 * Production-ready Templates Seeder API Endpoint
 * Location: app/api/whatsapp/templates/seed/route.js
 */

import { NextResponse } from 'next/server';
import { createTemplate, deleteTemplate, listTemplates, getConfig } from '@/lib/whatsapp/client';
import prisma from '@/lib/db';
import { STOREFRONT_ORIGIN } from '@/lib/storefront-url';

export const dynamic = 'force-dynamic';

const PRODUCTION_TEMPLATES = [
  {
    name: 'zica_otp_v3',
    category: 'UTILITY',
    language: 'en',
    components: [
      {
        type: 'BODY',
        text: 'Hello! Your reference number is {{1}}. Thank you for choosing Zica Bella.',
        example: {
          body_text: [
            ['123456']
          ]
        }
      }
    ]
  },
  {
    name: 'zica_order_confirmed_v1',
    category: 'UTILITY',
    language: 'en',
    components: [
      {
        type: 'BODY',
        text: 'Thank you for your order, {{1}}! Your order {{2}} has been confirmed successfully.',
        example: {
          body_text: [
            ['Karthik', '1024']
          ]
        }
      },
      {
        type: 'BUTTONS',
        buttons: [
          {
            type: 'URL',
            text: 'View Order',
            url: `${STOREFRONT_ORIGIN}/orders/{{1}}`,
            example: ['1024']
          }
        ]
      }
    ]
  },
  {
    name: 'zica_order_shipped',
    category: 'UTILITY',
    language: 'en',
    components: [
      {
        type: 'BODY',
        text: 'Update: Hello {{1}}, your order {{2}} has been shipped. Your tracking ID is {{3}} - thank you.',
        example: {
          body_text: [
            ['Karthik', '1024', '1234567890']
          ]
        }
      },
      {
        type: 'BUTTONS',
        buttons: [
          {
            type: 'URL',
            text: 'Track Order',
            url: `${STOREFRONT_ORIGIN}/orders/{{1}}`,
            example: ['1024']
          }
        ]
      }
    ]
  },
  {
    name: 'zica_order_delivered_v1',
    category: 'UTILITY',
    language: 'en',
    components: [
      {
        type: 'BODY',
        text: 'Update: Hello {{1}}, your order {{2}} has been delivered successfully. Thank you for shopping with us!',
        example: {
          body_text: [
            ['Karthik', '1024']
          ]
        }
      },
      {
        type: 'BUTTONS',
        buttons: [
          {
            type: 'URL',
            text: 'Rate Your Experience',
            url: `${STOREFRONT_ORIGIN}/orders/{{1}}`,
            example: ['1024']
          }
        ]
      }
    ]
  },
  {
    name: 'zica_cod_confirmation_v1',
    category: 'UTILITY',
    language: 'en',
    components: [
      {
        type: 'BODY',
        text: 'Hello {{1}}, we received order {{2}} for Cash on Delivery. Please confirm your order below to proceed with shipment.',
        example: {
          body_text: [
            ['Karthik', '1024']
          ]
        }
      },
      {
        type: 'BUTTONS',
        buttons: [
          {
            type: 'QUICK_REPLY',
            text: 'Confirm Order'
          },
          {
            type: 'QUICK_REPLY',
            text: 'Cancel Order'
          }
        ]
      }
    ]
  },
  {
    name: 'abandoned_cart_a1',
    category: 'MARKETING',
    language: 'en',
    components: [
      {
        type: 'HEADER',
        format: 'IMAGE',
        example: {
          header_url: ['https://images.unsplash.com/photo-1556821840-3a63f95609a7?q=80&w=400&auto=format&fit=crop']
        }
      },
      {
        type: 'BODY',
        text: 'Hello {{1}}, we noticed you left some items in your cart. Complete your purchase now to secure them!',
        example: {
          body_text: [
            ['Karthik']
          ]
        }
      },
      {
        type: 'BUTTONS',
        buttons: [
          {
            type: 'URL',
            text: 'Complete Purchase',
            url: `${STOREFRONT_ORIGIN}/{{1}}`,
            example: ['checkout']
          }
        ]
      }
    ]
  },
  {
    name: 'abandoned_cart_a2',
    category: 'MARKETING',
    language: 'en',
    components: [
      {
        type: 'BODY',
        text: 'Hi {{1}}, your cart items are still waiting for you! Use code {{2}} for an exclusive discount. Shop now before they sell out.',
        example: {
          body_text: [
            ['Karthik', 'ZICA10']
          ]
        }
      },
      {
        type: 'FOOTER',
        text: 'Reply STOP to opt out'
      },
      {
        type: 'BUTTONS',
        buttons: [
          {
            type: 'URL',
            text: 'Claim Discount',
            url: `${STOREFRONT_ORIGIN}/{{1}}`,
            example: ['checkout']
          }
        ]
      }
    ]
  },
  {
    name: 'abandoned_cart_a3',
    category: 'MARKETING',
    language: 'en',
    components: [
      {
        type: 'BODY',
        text: 'Hi {{1}}, this is your last chance! Your cart items are about to be released. Complete your purchase now to secure them.',
        example: {
          body_text: [
            ['Karthik']
          ]
        }
      },
      {
        type: 'FOOTER',
        text: 'Reply STOP to opt out'
      },
      {
        type: 'BUTTONS',
        buttons: [
          {
            type: 'URL',
            text: 'Buy Now',
            url: `${STOREFRONT_ORIGIN}/{{1}}`,
            example: ['checkout']
          }
        ]
      }
    ]
  },
  {
    name: 'zb_order_tracking',
    category: 'UTILITY',
    language: 'en',
    components: [
      {
        type: 'BODY',
        text: 'Hello {{1}}, your order {{2}} is on its way! Track the latest status using the button below.',
        example: {
          body_text: [
            ['Karthik', '1024']
          ]
        }
      },
      {
        type: 'BUTTONS',
        buttons: [
          {
            type: 'URL',
            text: 'Track Order',
            url: `${STOREFRONT_ORIGIN}/orders/{{1}}`,
            example: ['1024']
          }
        ]
      }
    ]
  }
];

export async function POST(req) {
  const { searchParams } = new URL(req.url);
  const force = searchParams.get('force') === 'true';

  const config = await getConfig();
  if (!config.configured) {
    return NextResponse.json(
      { error: 'WhatsApp not configured' },
      { status: 503 }
    );
  }

  const results = [];
  let successCount = 0;

  try {
    // 1. Fetch current templates from Meta
    let metaTemplates = [];
    try {
      metaTemplates = await listTemplates();
    } catch (err) {
      console.warn('[WhatsApp Seeder] Failed to list existing templates:', err.message);
    }

    const existingTemplates = new Map(
      (metaTemplates || []).map(t => [t.name, t.status])
    );

    for (const template of PRODUCTION_TEMPLATES) {
      const existingStatus = existingTemplates.get(template.name);

      if (!force && (existingStatus === 'APPROVED' || existingStatus === 'PENDING')) {
        console.log(`[WhatsApp Seeder] Skipping ${template.name} because it is already ${existingStatus}`);
        
        // Cache locally
        await prisma.whatsAppTemplate.upsert({
          where: { name: template.name },
          update: {
            category: template.category,
            language: template.language,
            status: existingStatus,
            components: template.components || [],
            updatedAt: new Date()
          },
          create: {
            name: template.name,
            category: template.category,
            language: template.language,
            status: existingStatus,
            components: template.components || []
          }
        });

        results.push({
          name: template.name,
          status: 'skipped',
          metaStatus: existingStatus
        });
        successCount++;
        continue;
      }

      try {
        if (existingStatus) {
          // Try to delete existing template first to overwrite it
          try {
            await deleteTemplate(template.name);
            console.log(`[WhatsApp Seeder] Deleted existing template: ${template.name}`);
            // Wait 2 seconds for deletion to register
            await new Promise(resolve => setTimeout(resolve, 2000));
          } catch (delError) {
            console.log(`[WhatsApp Seeder] Template ${template.name} deletion skipped/failed:`, delError.message);
          }
        }

        // Create new template on Meta
        const result = await createTemplate(template);
        
        // Cache locally
        await prisma.whatsAppTemplate.upsert({
          where: { name: template.name },
          update: {
            category: template.category,
            language: template.language,
            status: 'PENDING',
            components: template.components || [],
            updatedAt: new Date()
          },
          create: {
            name: template.name,
            category: template.category,
            language: template.language,
            status: 'PENDING',
            components: template.components || []
          }
        });

        results.push({
          name: template.name,
          status: 'submitted',
          result
        });
        successCount++;
      } catch (error) {
        console.error(`[WhatsApp Seeder] Failed to seed ${template.name}:`, error.message);
        results.push({
          name: template.name,
          status: 'error',
          error: error.message
        });
      }
    }
  } catch (error) {
    console.error('[WhatsApp Seeder] Global seeding error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    seeded: successCount,
    total: PRODUCTION_TEMPLATES.length,
    results
  });
}
