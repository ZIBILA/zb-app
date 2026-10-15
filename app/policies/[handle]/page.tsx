import { Metadata } from "next";
import { notFound } from "next/navigation";
import prisma from "@/lib/db";
import PolicyClient from "./PolicyClient";

interface PolicyPageProps {
  params: {
    handle: string;
  };
}

export async function generateMetadata({ params }: PolicyPageProps): Promise<Metadata> {
  const policy = await prisma.policy.findUnique({
    where: { handle: params.handle },
    select: { title: true }
  });

  if (!policy) return { title: "Policy Not Found | Zica Bella" };

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://zicabella.com';

  return {
    title: { absolute: `${policy.title} | Zica Bella | Premium Luxury Streetwear` },
    description: `Official ${policy.title} for Zica Bella luxury streetwear. Crafted with premium loopback fabrics, Italian design elements, and modern architectural standards.`,
    alternates: {
      canonical: `${siteUrl}/policies/${params.handle}`
    },
    openGraph: {
      title: `${policy.title} | Zica Bella | Premium Luxury Streetwear`,
      description: `Official ${policy.title} for Zica Bella luxury streetwear.`,
      url: `${siteUrl}/policies/${params.handle}`,
      siteName: "Zica Bella",
      locale: "en_IN",
      type: "website",
      images: [{ url: `${siteUrl}/og-image.jpg`, width: 1200, height: 630, alt: 'Zica Bella®' }]
    },
    twitter: {
      card: "summary_large_image",
      title: `${policy.title} | Zica Bella | Premium Luxury Streetwear`,
      description: `Official ${policy.title} for Zica Bella luxury streetwear.`,
      images: [`${siteUrl}/og-image.jpg`]
    }
  };
}

function generateSchema(policy: { handle: string; title: string; content: string; updatedAt: Date }) {
  const isContact = policy.handle === "contact-information";
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://zicabella.com';
  
  if (isContact) {
    return {
      "@context": "https://schema.org",
      "@type": "Organization",
      "name": "ZICA BELLA PRIVATE LIMITED",
      "alternateName": "Zica Bella",
      "url": siteUrl,
      "logo": `${siteUrl}/zb-logo-220px.png`,
      "contactPoint": [
        {
          "@type": "ContactPoint",
          "telephone": "+91-9220385011",
          "contactType": "customer service",
          "email": "support@zicabella.com",
          "availableLanguage": ["English", "Hindi"]
        },
        {
          "@type": "ContactPoint",
          "telephone": "+91-6002768463",
          "contactType": "customer service",
          "email": "support@zicabella.com",
          "availableLanguage": ["English", "Hindi"]
        }
      ],
      "address": {
        "@type": "PostalAddress",
        "streetAddress": "2207, Tower B, Bhutani Alphathum, Sector 90",
        "addressLocality": "Noida",
        "addressRegion": "Uttar Pradesh",
        "postalCode": "201305",
        "addressCountry": "IN"
      },
      "hoursOfOperation": {
        "@type": "OpeningHoursSpecification",
        "dayOfWeek": [
          "Monday",
          "Tuesday",
          "Wednesday",
          "Thursday",
          "Friday",
          "Saturday",
          "Sunday"
        ],
        "opens": "11:00",
        "closes": "19:30"
      },
      "sameAs": [
        "https://www.instagram.com/zica.bella",
        "https://www.youtube.com/@Zicabella"
      ]
    };
  }

  // General policy schema
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "name": policy.title,
    "description": `Official ${policy.title} for Zica Bella - Luxury Streetwear designed in Italy and crafted in India.`,
    "publisher": {
      "@type": "Organization",
      "name": "Zica Bella",
      "logo": {
        "@type": "ImageObject",
        "url": `${siteUrl}/zb-logo-220px.png`
      }
    },
    "dateModified": policy.updatedAt.toISOString()
  };
}

const FALLBACK_POLICIES: Record<string, { title: string; content: string }> = {
  "privacy-policy": {
    title: "Privacy Policy",
    content: `# PRIVACY POLICY\n\nLast updated: December 22, 2025\n\nZica Bella operates this store and website, including all related information, content, features, tools, products and services, in order to provide you, the customer, with a curated shopping experience (the "Services"). Zica Bella is powered by Shopify, which enables us to provide the Services to you. This Privacy Policy describes how we collect, use, and disclose your personal information when you visit, use, or make a purchase or other transaction using the Services or otherwise communicate with us.\n\n## Personal Information We Collect or Process\nWhen we use the term "personal information," we are referring to information that identifies or can reasonably be linked to you or another person. We may collect or process the following categories of personal information:\n- **Contact details**: name, address, billing address, shipping address, phone number, and email address.\n- **Financial information**: payment card information, transaction details.\n- **Account information**: username, password, security questions, preferences.\n- **Transaction information**: items viewed, cart additions, purchases, returns, exchanges.\n- **Communications**: content of messages sent to us.\n- **Device & Usage**: IP address, browser type, navigation patterns on our Services.\n\n## How We Use Your Personal Information\n- **Provide Services**: Processing orders, managing accounts, and facilitating returns.\n- **Marketing**: Sending promotional communications and personalized advertisements.\n- **Security**: Preventing fraud and ensuring a safe shopping environment.\n- **Legal Compliance**: Meeting tax, regulatory, and legal obligations.\n\n## How We Disclose Personal Information\nWe may share your information with:\n- **Shopify**: Our platform provider.\n- **Service Providers**: Delivery partners (Blue Dart, Delhivery), payment gateways (Razorpay).\n- **Professional Advisors**: Accountants, lawyers, and auditors.\n\n## Your Rights\nDepending on your location, you may have rights to access, correct, delete, or port your personal information. Contact us to exercise these rights.\n\n## Contact Information\nIf you have any questions about our privacy practices, please contact us at **support@zicabella.com** or visit us at Bhutani Alphathum Sector 90, 2207, Tower B, Noida, UP, 201304, IN.`
  },
  "terms-of-service": {
    title: "Terms of Service",
    content: `# TERMS OF SERVICE\n\nLast updated: November 22, 2025\n\nBy using the Zica Bella website and mobile app, you agree to these Terms of Service. Please read them carefully.\n\n## 1. Introduction\nZica Bella provides access to premium Indian streetwear. These terms apply to all visitors, users, and customers.\n\n## 2. Online Store Terms\n- You must be at least the age of majority in your jurisdiction.\n- You may not use our products for any illegal or unauthorized purpose.\n- You must not transmit any worms or viruses or any code of a destructive nature.\n\n## 3. Products & Services\n- We reserve the right to limit the sales of our products or Services to any person, geographic region or jurisdiction.\n- We have made every effort to display as accurately as possible the colors and images of our products.\n- Prices for our products are subject to change without notice.\n\n## 4. Accuracy of Billing & Account Information\nYou agree to provide current, complete and accurate purchase and account information for all purchases made at our store. You agree to promptly update your account and other information, including your email address and credit card numbers and expiration dates.\n\n## 5. Third-Party Links\nCertain content, products and services available via our Service may include materials from third-parties. We are not responsible for examining or evaluating the content or accuracy and we do not warrant and will not have any liability or responsibility for any third-party materials.\n\n## 6. Governing Law\nThese Terms of Service and any separate agreements whereby we provide you Services shall be governed by and construed in accordance with the laws of India.\n\n## 7. Contact\nQuestions about the Terms of Service should be sent to us at **support@zicabella.com**.`
  },
  "refund-policy": {
    title: "Refund Policy (Returns & Exchanges)",
    content: `# REFUND POLICY (RETURNS & EXCHANGES)\n\nLast updated: November 22, 2025\n\nAt Zica Bella, we want you to be completely satisfied with your purchase. If you are not happy with your order, we are here to help.\n\n## Returns & Exchanges\n- **Window**: Returns and exchanges are accepted within **7 days** from the date of delivery.\n- **Process**: Submit a request via our app or website. approved requests will trigger a pickup within 24-48 hours.\n- **Condition**: Items must be unworn, unwashed, unaltered, and with all original tags intact.\n- **Timeline**: Exchanges take approximately 7–10 working days after successful quality inspection at our warehouse.\n\n## Refunds\n- **Monetary Refunds**: We generally do not issue monetary refunds to original payment methods.\n- **Credit Notes**: Approved returns are refunded in the form of a **Credit Note / Gift Card** for future use.\n- **Inspection**: All returns are subject to a quality check before a credit note is issued.\n\n## Cancellations\n- **COD Orders**: Can be cancelled before dispatch.\n- **Prepaid Orders**: Cannot be cancelled once placed.\n\n## Damaged or Defective Items\nIf you receive a damaged or defective item, please contact us immediately at **support@zicabella.com** with photos of the issue.\n\n## Contact Support\n- **Phone**: +91 9220385011\n- **Email**: support@zicabella.com\n- **Hours**: Monday – Saturday, 11:00 AM to 7:00 PM (IST)`
  },
  "shipping-policy": {
    title: "Shipping Policy",
    content: `# SHIPPING POLICY\n\nLast updated: November 22, 2025\n\nZica Bella delivers high-end streetwear across India. Here is how we handle shipping.\n\n## Shipping Costs\n- **Free Shipping**: Available on all orders above **₹999**.\n- **Standard Shipping**: ₹99 fee for orders below ₹999.\n- **Express Shipping**: Available in select regions for approximately ₹199.\n\n## Delivery Timelines\n- **Metros**: 2–4 business days.\n- **Tier-2 Cities**: 3–5 business days.\n- **Rest of India**: 5–10 business days.\n*Note: Timelines are estimates and can vary based on courier performance.*\n\n## Order Tracking\nOnce your order is dispatched, you will receive a tracking link via email and SMS. You can also track your order directly in the "Orders" section of the Zica Bella app.\n\n## Delivery Partners\nWe partner with leading logistics companies including Blue Dart, DTDC, Delhivery, and Ecom Express to ensure your drip reaches you safely.\n\n## Support\nFor shipping-related queries, reach us at:\n- **Call**: +91 6002768463\n- **Email**: support@zicabella.com`
  },
  "contact-information": {
    title: "Contact Information",
    content: `# CONTACT INFORMATION\n\nFor any assistance or queries, please get in touch with our Client Advisors.\n\n#### Trade Name:\n**ZICA BELLA PRIVATE LIMITED**\n\n#### Customer Support:\n- **Email**: support@zicabella.com\n- **Phone**: +91 9220385011 / +91 6002768463\n\n#### Registered Office:\nZica Bella Pvt. Ltd.\n2207, Tower B, Bhutani Alphathum\nSector 90, Noida – 201305\nUttar Pradesh, India\n\n#### Business Hours:\n- **Monday to Sunday**: 11:00 AM – 7:30 PM (IST)\n\n#### Social Channels:\n- **Instagram**: @zica.bella\n- **YouTube**: Zica Bella Official`
  },
  "about-us": {
    title: "About Us",
    content: `# ABOUT ZICA BELLA\n\n### DRIP IT TILL YOU FLIP IT.\nModern Indian Streetwear. Designed for Expression.\n\nZica Bella is a modern Indian streetwear brand built for a generation that values individuality, comfort, and confident self-expression. Rooted in contemporary street culture and shaped by global fashion sensibilities, Zica Bella creates clothing that feels intentional, elevated, and wearable every single day.\n\n## Our Philosophy\nWe design for people who don’t just wear clothes, but use fashion as a language. From oversized t-shirts and relaxed denims to hoodies, jackets, and everyday streetwear essentials, every Zica Bella piece is crafted to balance style, comfort, and attitude.\n\n## A Streetwear Brand Designed for the New India\nIndia’s fashion landscape is evolving. Today’s generation—especially those between 16 and 30—wants more than fast fashion. They want clothing that reflects who they are, fits their lifestyle, and feels premium without being inaccessible.\n\n## What Makes Us Different\n- **Oversized Fits Done Right**: Proportions that look intentional and structured.\n- **Premium Fabrics**: Heavyweight cottons and durable textures designed for long wear.\n- **Indian Context**: Clothing designed for Indian weather and body types.\n\n## Our Vision\nTo become one of India’s most trusted and recognisable streetwear brands known for quality, fit, and authenticity while staying true to the culture that inspires us.\n\n**Wear bold. Wear comfortable. Wear Zica Bella.**`
  }
};

const DEFAULT_POLICY_LIST = [
  { handle: "about-us", title: "About Us" },
  { handle: "contact-information", title: "Contact Information" },
  { handle: "privacy-policy", title: "Privacy Policy" },
  { handle: "refund-policy", title: "Refund Policy (Returns & Exchanges)" },
  { handle: "shipping-policy", title: "Shipping Policy" },
  { handle: "terms-of-service", title: "Terms of Service" }
];

export default async function PolicyPage({ params }: PolicyPageProps) {
  let policyData: { handle: string; title: string; content: string; updatedAt: Date } | null = null;
  let dbPolicies: { handle: string; title: string }[] = [];

  try {
    const [policy, allPolicies] = await Promise.all([
      prisma.policy.findUnique({
        where: { handle: params.handle },
      }),
      prisma.policy.findMany({
        select: { handle: true, title: true },
        orderBy: { title: 'asc' },
      }),
    ]);
    policyData = policy;
    dbPolicies = allPolicies;
  } catch (err) {
    console.error("Policy DB fetch error:", err);
  }

  // Fallback to static policy content if DB record is missing
  if (!policyData) {
    const fallback = FALLBACK_POLICIES[params.handle];
    if (fallback) {
      policyData = {
        handle: params.handle,
        title: fallback.title,
        content: fallback.content,
        updatedAt: new Date(),
      };
    } else {
      notFound();
    }
  }

  const schema = generateSchema(policyData);

  // Merge DB policies with default policies list so all 6 policy options always exist
  const combinedMap = new Map<string, { handle: string; title: string }>();
  DEFAULT_POLICY_LIST.forEach(p => combinedMap.set(p.handle, p));
  dbPolicies.forEach(p => combinedMap.set(p.handle, { handle: p.handle, title: p.title }));
  const serializedAllPolicies = Array.from(combinedMap.values());

  const serializedPolicy = {
    handle: policyData.handle,
    title: policyData.title,
    content: policyData.content,
    updatedAt: policyData.updatedAt.toISOString(),
  };

  return (
    <>
      {/* Dynamic JSON-LD Structured Schema for AI & SEO */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
      />
      <PolicyClient activePolicy={serializedPolicy} allPolicies={serializedAllPolicies} />
    </>
  );
}
