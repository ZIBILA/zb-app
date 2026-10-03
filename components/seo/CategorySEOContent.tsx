interface CategorySEOContentProps {
  slug: string
}

const content: Record<
  string,
  { heading: string; intro: string; faqs: { q: string; a: string }[] }
> = {
  'graphic-tees': {
    heading: 'Heavyweight Graphic Tees & Streetwear Blanks — Zica Bella®',
    intro:
      'Engineered for the subculture. Zica Bella\'s graphic tees represent a collision of luxury streetwear aesthetics, custom boxy silhouettes, and high-density industrial prints. Each piece is crafted in India from 240+ GSM double-yarn pre-shrunk cotton blanks to deliver the ultimate relaxed drop-shoulder drape that maintains its structure.',
    faqs: [
      {
        q: 'What makes Zica Bella graphic tees different from mass-market brands in India?',
        a: 'Zica Bella graphic tees are built from scratch on custom patterns, not standard pre-made wholesale blanks. We use custom-developed 240+ GSM heavyweight double-yarn cotton, dropped shoulder seams, and tight, double-needle stitched ribbed collars that will not warp after washing. Our graphics are applied using premium, high-density screen printing and screen-puff techniques that resist cracking and fading.',
      },
      {
        q: 'Are Zica Bella streetwear graphic tees available under ₹1000?',
        a: 'Yes, select drops and core streetwear graphic tees start at ₹999, featuring the same premium fabric architecture and custom packaging as our limited-edition capsule collections.',
      },
      {
        q: 'What fabric structure and treatments are used for Zica Bella tees?',
        a: 'We use 100% premium combed cotton, treated with silicon and bio-washes for a soft vintage feel. The fabric is pre-shrunk to ensure consistent fitting and shape retention over years of wear.',
      },
      {
        q: 'How should I wash my Zica Bella graphic tees to preserve the print?',
        a: 'For maximum longevity, we recommend washing our tees inside out in cold water on a gentle cycle, and hang drying them. Avoid direct ironing on the high-density graphic prints.',
      },
    ],
  },
  'tshirts-under-5000': {
    heading: 'Best Streetwear & Oversized Tees Under ₹5000 — Zica Bella®',
    intro:
      'High-end streetwear fabric architecture without the luxury markup. Zica Bella offers a curated range of premium heavyweight graphic tees, boxy fits, and statement apparel priced honestly under ₹5000. No fast fashion shortcuts. Crafted in India with absolute quality control.',
    faqs: [
      {
        q: 'Which are the best premium streetwear brands under ₹5000 in India?',
        a: 'Zica Bella stands out as India\'s premier D2C streetwear label offering luxury-tier heavy cotton blanks under ₹5000. By controlling our entire design-to-production chain in-house, we deliver the same heavyweight loopback fleece and drop-shoulder silhouettes as high-end global brands, but at an honest price.',
      },
      {
        q: 'What quality standards do Zica Bella t-shirts under ₹5000 meet?',
        a: 'Every garment passes a rigid multi-point quality check. We inspect stitch density, seam strength, collar elasticity, and print accuracy to guarantee that your t-shirt holds up as a durable streetwear collector\'s piece.',
      },
      {
        q: 'Is shipping free for Zica Bella orders in India?',
        a: 'Yes, we provide free express shipping across India for all orders above ₹999. Most single oversized tee purchases qualify automatically.',
      },
      {
        q: 'Does Zica Bella support returns and exchanges?',
        a: 'We offer an easy 7-day return and exchange window. If your fit isn\'t exactly how you envisioned, we will arrange a free reverse pickup and offer a replacement size or full refund.',
      },
    ],
  },
  'oversized-tees': {
    heading: 'Boxy Drop-Shoulder Oversized Tees for Men — Zica Bella® India',
    intro:
      'Engineered with a relaxed, slouchy body and dropped shoulders, Zica Bella oversized tees are the ultimate streetwear staple for men. Crafted from heavy-density 100% cotton blanks, they provide a clean boxy drape that hangs perfectly from XS to 3XL.',
    faqs: [
      {
        q: 'How do Zica Bella oversized tees fit compared to standard t-shirts?',
        a: 'Our oversized tees are custom-patterned to be boxy and loose-fitting with dropped shoulders and longer, wider sleeves. We recommend ordering your true size for the intended streetwear drape, or sizing down if you prefer a standard relaxed fit.',
      },
      {
        q: 'Are the oversized tees unisex?',
        a: 'Yes. All Zica Bella oversized garments are designed with a unisex fit architecture, suited for all body types looking to achieve a structured, modern street style.',
      },
      {
        q: 'What GSM weight are Zica Bella oversized tees?',
        a: 'Our oversized tees are crafted from 240+ GSM double-yarn pre-shrunk cotton. This heavyweight construction ensures the tee holds its boxy shape and doesn\'t go thin or shapeless after washing.',
      },
    ],
  },
  'tshirts': {
    heading: 'Acid Wash T-Shirts for Men — Vintage Streetwear Tees | Zica Bella®',
    intro:
      'Each Zica Bella acid wash tee is a one-of-a-kind piece. The vintage acid-wash process creates unique colour variations across heavyweight 240+ GSM cotton, giving every t-shirt its own character. Combined with our signature drop-shoulder oversized fit, these tees bridge vintage aesthetics with modern Indian streetwear construction. Silicon and bio-wash treatments deliver a broken-in softness from the first wear.',
    faqs: [
      {
        q: 'What is acid wash and how is it done on Zica Bella tees?',
        a: 'Acid washing is a garment finishing technique where pumice stones soaked in an oxidising agent are tumbled with the dyed fabric to remove colour unevenly, creating a vintage, high-contrast pattern. Our tees undergo this process after construction, so each piece has a unique wash pattern.',
      },
      {
        q: 'Do acid wash t-shirts fade further with washing?',
        a: 'Minimal additional fading occurs with proper care. We recommend cold water, inside-out washing on a gentle cycle. The pre-treated finish is designed to stabilise after the factory wash process.',
      },
      {
        q: 'Are acid wash tees available in multiple colours?',
        a: 'Yes. We offer acid-wash finishes across black, grey, olive, and stone colourways, each producing distinct vintage wash results. Check individual product pages for available washes.',
      },
      {
        q: 'What sizes are available for Zica Bella acid wash tees?',
        a: 'Our acid wash tees are available from XS to 3XL in our standard oversized drop-shoulder fit. Refer to the size guide on each product page for exact measurements.',
      },
    ],
  },
  'authentic-streetwear': {
    heading: 'Heavyweight 240 GSM Cotton T-Shirts for Men — Premium Streetwear | Zica Bella®',
    intro:
      'Built for substance over trend. Zica Bella\'s heavyweight collection uses custom-developed 240+ GSM double-yarn combed cotton that delivers a structured, boxy drape without the stiffness. Pre-shrunk and bio-washed for a vintage hand-feel from day one, these tees maintain their shape and weight through years of wear. Every piece is cut on custom oversized patterns with drop-shoulder seams and reinforced ribbed collars.',
    faqs: [
      {
        q: 'What does 240 GSM mean for a t-shirt?',
        a: 'GSM stands for grams per square metre and measures fabric weight. Standard fast-fashion tees are 140–160 GSM. At 240+ GSM, our tees are nearly 60% heavier, which means a thicker, more structured hand-feel, better drape, and significantly longer lifespan.',
      },
      {
        q: 'Do heavyweight tees feel stiff or uncomfortable in Indian summers?',
        a: 'No. Our 240 GSM cotton is combed and bio-washed to achieve a soft, broken-in hand-feel. The cotton is breathable and the oversized silhouette allows airflow, making them comfortable even in warm weather.',
      },
      {
        q: 'How does heavyweight cotton compare to regular cotton for prints?',
        a: 'Heavier fabric provides a more stable printing surface, which means sharper details and better ink absorption. Our high-density screen prints bond more effectively with the dense cotton fibres, resulting in prints that resist cracking and fading significantly longer than on lighter fabrics.',
      },
    ],
  },
  'jeans': {
    heading: 'Baggy Jeans & Wide Leg Denim for Men — Streetwear Denim | Zica Bella®',
    intro:
      'Zica Bella\'s denim collection brings streetwear attitude to premium denim construction. From wide-leg baggy jeans to carpenter-style builds with raw-edge finishing, every pair is designed for statement silhouettes. Vintage washes, mosaic laser detailing, and relaxed fits combine heritage denim craft with the bold proportions of modern Indian streetwear. Heavyweight denim fabrics ensure durability without sacrificing comfort.',
    faqs: [
      {
        q: 'What styles of baggy jeans does Zica Bella offer?',
        a: 'We offer wide-leg baggy jeans, relaxed-fit carpenter denim, barrel-cut silhouettes, and mosaic laser-detailed styles. Each is designed with a relaxed streetwear fit that sits comfortably at the waist and falls wide through the leg.',
      },
      {
        q: 'Are Zica Bella jeans true to size for men?',
        a: 'Our denim is designed with a relaxed, baggy fit. We recommend ordering your regular waist size for the intended loose silhouette. Each product page includes detailed waist, inseam, and thigh measurements for reference.',
      },
      {
        q: 'What denim washes are available?',
        a: 'Our denim collection spans raw indigo, vintage brown, acid-wash grey, cyber-wash, black mosaic, and beige earth-tone washes. Each wash is developed in-house for a distinctive street aesthetic.',
      },
      {
        q: 'How should I care for Zica Bella denim?',
        a: 'For best results, wash your denim inside out in cold water, avoid tumble drying, and hang dry. Limiting washes to once every 5–6 wears helps preserve colour depth and the raw-edge detailing.',
      },
    ],
  },
  'shorts': {
    heading: 'Denim Jorts & Baggy Shorts for Men — Summer Streetwear | Zica Bella®',
    intro:
      'Built for warm-weather street style. Zica Bella\'s denim jorts and baggy shorts combine oversized proportions with premium denim construction. Featuring raw-edge hems, acid-wash finishes, laser-printed graphics, and utility-inspired details like handcrafted belts and panel stitching, each pair is engineered for impact. Cut from the same heavyweight denim as our full-length jeans, these shorts bring substance to summer streetwear.',
    faqs: [
      {
        q: 'What is the difference between jorts and regular shorts?',
        a: 'Jorts are denim shorts — specifically cut from jeans-weight denim fabric rather than lightweight cotton or nylon. Our jorts feature the same raw-edge finishing, vintage washes, and structured denim construction as our full-length baggy jeans, cut to a knee-length or above-knee silhouette.',
      },
      {
        q: 'What lengths are available for Zica Bella denim shorts?',
        a: 'Our denim jorts are designed with a relaxed, above-knee to knee-length cut. Exact inseam measurements are listed on each product page, and we offer sizes from S to 3XL.',
      },
      {
        q: 'Can denim jorts be styled as streetwear?',
        a: 'Absolutely. Denim jorts are a core piece in streetwear styling. Pair them with oversized graphic tees, jerseys, or utility shirts for a bold, proportioned street look. Our laser-printed and acid-wash finishes add visual interest that elevates the fit.',
      },
    ],
  },
  'shirts': {
    heading: 'Oversized Streetwear Shirts for Men — Utility & Panel Shirts | Zica Bella®',
    intro:
      'Zica Bella\'s streetwear shirts redefine the button-front silhouette for modern street culture. Featuring oversized boxy fits, panelled construction with corduroy accents, zip detailing, and premium fabric blends, each shirt is designed as a standalone statement piece. Whether worn open over a tee or buttoned up as a structured layer, these shirts deliver the same attention to detail and construction quality as our core tee line.',
    faqs: [
      {
        q: 'How do Zica Bella oversized shirts fit?',
        a: 'Our shirts are designed with an intentionally oversized, boxy silhouette with dropped shoulders. Order your true size for the streetwear-intended loose drape, or size down one for a more conventional relaxed fit.',
      },
      {
        q: 'What fabrics are used in Zica Bella shirts?',
        a: 'We use premium cotton blends, washed corduroy panels, and structured woven fabrics depending on the design. Each product page details the specific fabric composition and weight.',
      },
      {
        q: 'Are streetwear shirts suitable for layering?',
        a: 'Yes. Our oversized shirts are designed to work both as a standalone top and as a layering piece over graphic tees or under jackets. The boxy cut provides room for comfortable layering without restricting movement.',
      },
    ],
  },
  'jackets': {
    heading: 'Streetwear Jackets for Men — Leather & Denim Jackets | Zica Bella®',
    intro:
      'From premium leather jackets with crocodile-embossed textures to vintage-wash denim jackets and half-zip layering pieces, Zica Bella\'s outerwear collection is built for street-level impact. Each jacket features structured construction, bold hardware, and finishes that develop character with wear. Designed as collector\'s pieces that anchor a streetwear wardrobe across seasons.',
    faqs: [
      {
        q: 'What types of jackets does Zica Bella offer?',
        a: 'Our jacket collection includes premium leather jackets with textured finishes, acid-wash and vintage denim jackets, and half-zip layered utility pieces. Each style is designed with a streetwear-forward silhouette.',
      },
      {
        q: 'What leather is used in Zica Bella leather jackets?',
        a: 'Our leather jackets use premium leather with crocodile-embossed and textured finishes. Specific material details are listed on each product page. Each jacket is designed to develop a rich patina with wear.',
      },
      {
        q: 'How should I care for a leather jacket?',
        a: 'Store your leather jacket on a padded hanger in a cool, dry space. Wipe with a damp cloth for everyday cleaning, and apply leather conditioner periodically to maintain suppleness. Avoid machine washing.',
      },
      {
        q: 'Are Zica Bella denim jackets pre-washed?',
        a: 'Yes. Our denim jackets undergo vintage acid-wash and distressing processes during production, so the finish you receive is the finished look. The wash will not significantly change with subsequent wears or washes.',
      },
    ],
  },
  'jersey': {
    heading: 'Oversized Streetwear Jerseys for Men — Graphic Jerseys | Zica Bella®',
    intro:
      'Zica Bella jerseys sit at the intersection of sport and subculture. Oversized mesh panels, motorsport-inspired graphics, bold numbering, and full-body print coverage deliver high-impact visual identity. Designed in lightweight, breathable fabrics with the same attention to fit and proportion as our heavyweight tee line, these jerseys are engineered for movement and statement.',
    faqs: [
      {
        q: 'What materials are Zica Bella jerseys made from?',
        a: 'Our jerseys use lightweight mesh and performance-blend fabrics with sublimated or screen-printed graphics. The breathable construction makes them suitable for both active wear and streetwear styling.',
      },
      {
        q: 'How do the jerseys fit?',
        a: 'Jerseys follow our oversized streetwear fit with relaxed shoulders and a longer body length. Order your true size for the intended loose proportions.',
      },
      {
        q: 'Can jerseys be worn as everyday streetwear?',
        a: 'Absolutely. Our jerseys are designed as crossover pieces — equally at home layered over a tee for casual street looks as they are for active wear. The bold graphics and oversized fit make them statement pieces in any rotation.',
      },
    ],
  },
};

export function CategorySEOContent({ slug }: CategorySEOContentProps) {
  const c = content[slug]
  if (!c) return null

  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": c.faqs.map(faq => ({
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
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <section aria-label="About this collection" style={{ marginTop: '3rem' }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1rem' }}>
          {c.heading}
        </h2>
        <p style={{ opacity: 0.75, lineHeight: 1.7, maxWidth: '65ch', marginBottom: '2rem' }}>
          {c.intro}
        </p>
      </section>
    </>
  )
}
