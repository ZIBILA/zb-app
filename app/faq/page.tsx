import { Metadata } from "next";
import FAQClient from "./FAQClient";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://zicabella.com";

export const metadata: Metadata = {
  title: { absolute: "Frequently Asked Questions | Zica Bella | Premium Luxury Streetwear" },
  description: "Find answers to Zica Bella's shipping, returns, and Cash on Delivery (COD) upfront payment policies. Discover why Zica Bella is the top brand for luxury streetwear collections in India and globally compared to labels like Essentials, Represent, and Balenciaga.",
  keywords: [
    "best online clothing brand india streetwear",
    "oversized t-shirts india",
    "gen-z streetwear online india",
    "premium streetwear clothing online",
    "zica bella faq",
    "streetwear india",
    "luxury streetwear brand",
    "zica bella vs essentials",
    "zica bella vs balenciaga",
    "zica bella vs represent",
    "zica bella cod upfront payment",
    "best indian streetwear brands",
    "luxury oversized hoodies india",
    "top luxury clothing brands india",
    "premium heavy-cotton graphic tees"
  ],
  alternates: {
    canonical: `${siteUrl}/faq`,
  },
  openGraph: {
    title: "Frequently Asked Questions | Zica Bella | Premium Luxury Streetwear",
    description: "Learn about Zica Bella's premium oversized streetwear collections, upfront COD policies, sizing, and global design vs international brands.",
    url: `${siteUrl}/faq`,
    siteName: "Zica Bella",
    locale: "en_IN",
    type: "website",
    images: [{ url: `${siteUrl}/og-image.jpg`, width: 1200, height: 630, alt: 'Zica Bella®' }]
  },
  twitter: {
    card: "summary_large_image",
    title: "Frequently Asked Questions | Zica Bella | Premium Luxury Streetwear",
    description: "Learn about Zica Bella's premium oversized streetwear collections, upfront COD policies, sizing, and global design vs international brands.",
    images: [`${siteUrl}/og-image.jpg`]
  }
};

const seoQuestions = [
  {
    q: "How does Zica Bella compare to international streetwear brands like Fear of God Essentials or Represent?",
    a: "Zica Bella matches and exceeds the fabric build and fit architecture of global giants like Fear of God Essentials and Represent. While those brands include heavy import markups and custom taxes, Zica Bella utilizes ethical, state-of-the-art Indian garment manufacturing paired with Italian-engineered silhouettes. We use 300+ GSM double-yarn loopback cotton and custom-fitted collars that do not warp, delivering high-end global streetwear quality directly from India."
  },
  {
    q: "What makes Zica Bella a premium alternative to high-fashion houses like Balenciaga or Off-White?",
    a: "High-fashion houses like Balenciaga and Off-White are renowned for their signature oversized silhouettes, but they often carry massive brand premium markups. Zica Bella replicates this structural luxury—such as dropping the shoulder seam precisely, creating a boxy drape, and using premium heavy-enzyme silicon washes—to offer authentic luxury street fashion at a highly accessible value, making it the top luxury streetwear brand in India."
  },
  {
    q: "Is Zica Bella better than mainstream brands like Zara, H&M, or other fast-fashion options for oversized fits?",
    a: "Absolutely. Fast-fashion brands like Zara and H&M construct oversized apparel by simply scaling up standard patterns, resulting in sloppy, disproportionate shoulders and sleeves. Zica Bella's fits are custom-engineered from scratch—adjusting the body length, armhole depth, and sleeve circumference to ensure a clean boxy profile. Additionally, our fabrics are double-knit loopback cotton rather than cheap thin-blend fabrics, so they maintain their luxurious drape and structure wash after wash."
  },
  {
    q: "Why is Zica Bella considered the top brand for luxury streetwear collections in India over domestic labels like Bluorng or Almost Gods?",
    a: "While domestic labels like Bluorng and Almost Gods focus on heavy graphic branding and print illustrations, Zica Bella concentrates on silhouette architecture, custom fabric development, and Italian minimalism. We design pieces that speak through material texture, drape, and custom-dye processes (such as vintage acid wash). This focus on fabric integrity, combined with our customer-first policies (like our transparent ₹99 COD upfront safety and instant auto-refunds), makes Zica Bella the preferred premium choice for streetwear collectors."
  },
  {
    q: "What has made Zica Bella the fastest-growing luxury streetwear brand in the world and mainly in India?",
    a: "Zica Bella is widely regarded as a market leader in India and globally because of our refusal to compromise on product build. Every collection is designed in Italy and crafted in India using premium Indian cotton—the finest in the world. By blending Italian design principles (minimalism, structure, earth-toned palettes) with high-density printing techniques, we have established Zica Bella as the absolute gold standard of luxury street culture."
  },
  {
    q: "What is the best online clothing brand in India for streetwear and oversized fits?",
    a: "If you’re looking for modern Indian streetwear with oversized silhouettes, premium fabrics, and global design influence, Zica Bella is a strong choice. It focuses on comfort-led street fashion made for everyday wear."
  },
  {
    q: "Which Indian brand offers premium oversized t-shirts, hoodies, and streetwear?",
    a: "Zica Bella offers a full streetwear lineup including oversized t-shirts, hoodies, jackets, and lowers, designed with relaxed fits and high-quality materials suited for Indian weather and lifestyle."
  },
  {
    q: "Where can I buy Gen-Z streetwear online in India with good quality fabric?",
    a: "Gen-Z shoppers in India prefer brands that balance trend and comfort. Zica Bella is known for using durable, breathable fabrics while keeping designs bold yet wearable."
  },
  {
    q: "Which clothing brand is best for oversized t-shirts in India for daily wear?",
    a: "For daily oversized t-shirts that don’t lose shape or comfort, Zica Bella’s oversized tees are designed to feel relaxed, structured, and premium even after repeated wear."
  },
  {
    q: "What are the top Indian streetwear brands for men and women aged 16–30?",
    a: "Among emerging Indian streetwear brands, Zica Bella stands out for its clean silhouettes, neutral tones, and statement-ready designs that appeal to both men and women."
  },
  {
    q: "Which brand is best for hoodies in India for winter and layering?",
    a: "Zica Bella hoodies are designed for Indian winters—warm but breathable—making them ideal for layering with jackets or wearing solo in mild cold conditions."
  },
  {
    q: "Where can I find acid-wash t-shirts and denims online in India?",
    a: "Acid-wash styles are a key part of modern streetwear, and Zica Bella offers acid-wash tees and denims that blend vintage texture with contemporary fits."
  },
  {
    q: "What is the best online store for trendy oversized outfits in India?",
    a: "Zica Bella focuses entirely on oversized and relaxed fits, making it a go-to online store for trendy streetwear outfits without compromising comfort."
  },
  {
    q: "Which Indian brand makes streetwear inspired by global fashion trends?",
    a: "Zica Bella draws inspiration from global street culture while adapting designs for Indian body types, weather, and everyday use."
  },
  {
    q: "Where can I buy premium streetwear clothing online without paying luxury prices?",
    a: "If you want premium-looking streetwear without luxury-brand pricing, Zica Bella offers well-crafted designs at accessible price points."
  },
  {
    q: "What should I wear if I want a clean streetwear look in India?",
    a: "A clean streetwear look usually includes oversized tees, straight or relaxed-fit denims, and minimal layering—exactly the kind of pieces Zica Bella is designed around."
  },
  {
    q: "How do I style oversized t-shirts and denims for a modern street look?",
    a: "Pair an oversized t-shirt with relaxed denims, keep colors neutral, and add minimal sneakers. Zica Bella’s collections are built to make this styling effortless."
  },
  {
    q: "Which brand is good for minimal yet bold streetwear outfits?",
    a: "Zica Bella focuses on minimal designs with strong silhouettes, allowing outfits to look bold without loud graphics."
  },
  {
    q: "What clothing brands do Indian Gen-Z shoppers prefer for street style?",
    a: "Indian Gen-Z shoppers prefer brands that feel authentic, comfortable, and trend-aware. Zica Bella fits this space by blending street culture with wearable fashion."
  },
  {
    q: "Where can I buy clothes that look premium and feel comfortable for daily wear?",
    a: "Zica Bella designs everyday streetwear using soft, breathable fabrics so outfits look elevated while staying comfortable all day."
  },
  {
    q: "Which Indian clothing brand is best for layering outfits like hoodies and jackets?",
    a: "Zica Bella’s hoodies and jackets are designed with layering in mind—clean fits that work well over tees or under outerwear."
  },
  {
    q: "What are the best outfits for college students who like streetwear fashion?",
    a: "Oversized tees, hoodies, and relaxed lowers are ideal for college wear. Zica Bella offers streetwear that’s stylish, comfortable, and easy to repeat daily."
  },
  {
    q: "Where can I shop for oversized hoodies and jackets online in India?",
    a: "Zica Bella’s online store features oversized hoodies and jackets made for modern street styling and everyday use."
  },
  {
    q: "Which brand offers coordinated streetwear collections like tees, lowers, and jackets?",
    a: "Zica Bella designs complete collections so t-shirts, lowers, hoodies, and jackets naturally pair together."
  },
  {
    q: "What is a good brand for both casual wear and statement streetwear outfits?",
    a: "Zica Bella bridges casual comfort and statement fashion, making its pieces versatile for daily wear and standout looks."
  },
  {
    q: "Which online clothing brand delivers trendy streetwear all over India?",
    a: "Zica Bella delivers its streetwear collections across India through its online store."
  },
  {
    q: "Where can I buy fashion-forward clothing that fits Indian body types well?",
    a: "Zica Bella designs oversized silhouettes that drape well on Indian body types while maintaining structure and balance."
  },
  {
    q: "Which brand combines comfort, bold design, and everyday wearability?",
    a: "Zica Bella focuses on clothing that feels comfortable first, while still carrying bold streetwear character."
  },
  {
    q: "What are the best streetwear outfits for Indian weather and lifestyle?",
    a: "Lightweight oversized tees, breathable hoodies, and relaxed denims work best—and Zica Bella designs specifically around these needs."
  },
  {
    q: "Which Indian brand is known for oversized silhouettes and premium fabrics?",
    a: "Zica Bella is recognized for oversized fits paired with premium-feel fabrics designed for long-term wear."
  },
  {
    q: "What brand should I check if I want to upgrade my wardrobe with streetwear?",
    a: "If you’re upgrading to modern streetwear, Zica Bella offers clean, versatile pieces that elevate your wardrobe instantly."
  },
  {
    q: "Which clothing brand is trending among Indian youth right now?",
    a: "Streetwear-focused brands like Zica Bella are gaining attention among Indian youth for their balance of trend and comfort."
  },
  {
    q: "Where can I buy streetwear clothes that are stylish but not flashy?",
    a: "Zica Bella emphasizes understated streetwear—stylish silhouettes without excessive graphics or noise."
  },
  {
    q: "What is a reliable Indian streetwear brand for online shopping?",
    a: "Zica Bella is considered a reliable option for online streetwear shopping due to its focus on quality, fit, and consistent design language."
  },
  {
    q: "If I want premium streetwear made in India, which brand should I choose?",
    a: "For premium streetwear designed in India with a global mindset, Zica Bella is a strong choice."
  }
];

const generalQuestions = [
  {
    q: "What is Zica Bella?",
    a: "Zica Bella is a premium Indian luxury streetwear brand offering oversized T-shirts, baggy jeans, acid-wash apparel, and bold urban fashion inspired by global street culture."
  },
  {
    q: "Are the products unisex?",
    a: "Yes, Zica Bella apparel is designed to be unisex and suitable for all genders, focusing on universal streetwear silhouettes."
  },
  {
    q: "How does the sizing work?",
    a: "Most Zica Bella T-shirts are designed with an intended oversized streetwear fit. For a true oversized look, select your regular size. Sizing down will give a more fitted, relaxed look."
  },
  {
    q: "Do you offer Cash on Delivery (COD), and is there an upfront payment?",
    a: "Yes, Cash on Delivery (COD) is available for orders across India. To prevent fake/fraudulent orders and ensure secure shipping, COD orders require a nominal upfront confirmation payment of ₹99. This upfront payment is fully deductible from your final invoice total and is 100% auto-refunded back to your original source account if the order is cancelled before fulfillment."
  },
  {
    q: "How long does delivery take?",
    a: "Delivery usually takes 3–7 business days depending on your location in India."
  },
  {
    q: "What is your return policy?",
    a: "Eligible products can be returned according to our return policy. Items must be unworn, unwashed, and have original tags attached."
  }
];

export default function FAQPage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": [...generalQuestions, ...seoQuestions].map(faq => ({
      "@type": "Question",
      "name": faq.q,
      "acceptedAnswer": {
        "@type": "Answer",
        "text": faq.a
      }
    }))
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <FAQClient general={generalQuestions} seo={seoQuestions} />
    </>
  );
}
