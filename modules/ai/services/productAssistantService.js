import axios from 'axios';

const getGroqConfig = () => {
  const apiKey =
    process.env.GROQ_API_KEY ||
    process.env.ROQ_API_KEY ||
    process.env.GROQ_KEY ||
    process.env.GROQ_APIKEY ||
    '';

  const baseUrl = (process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/$/, '');
  const model = process.env.GROQ_CHAT_MODEL || 'llama-3.1-8b-instant';
  const apiUrl = `${baseUrl}/chat/completions`;

  return { apiKey, model, apiUrl };
};

const normalizePayload = (payload) => {
  const safe = payload && typeof payload === 'object' ? payload : {};
  const quantityEstimate = safe.quantityEstimate && typeof safe.quantityEstimate === 'object'
    ? safe.quantityEstimate
    : {};

  return {
    needsUseCase: Boolean(safe.needsUseCase),
    assistantReply: String(
      safe.assistantReply ||
        'Please share more details about usage, environment, and expected quality so I can guide you accurately.'
    ),
    suggestedProducts: Array.isArray(safe.suggestedProducts) ? safe.suggestedProducts.slice(0, 6) : [],
    recommendedSpecs: Array.isArray(safe.recommendedSpecs) ? safe.recommendedSpecs.slice(0, 8) : [],
    alternativeProducts: Array.isArray(safe.alternativeProducts) ? safe.alternativeProducts.slice(0, 6) : [],
    buyingChecklist: Array.isArray(safe.buyingChecklist) ? safe.buyingChecklist.slice(0, 8) : [],
    quantityEstimate: {
      estimatedRange: String(quantityEstimate.estimatedRange || ''),
      calculationMethod: String(quantityEstimate.calculationMethod || ''),
      assumptions: Array.isArray(quantityEstimate.assumptions)
        ? quantityEstimate.assumptions.slice(0, 8)
        : [],
      notes: String(quantityEstimate.notes || ''),
    },
    measurementChecklist: Array.isArray(safe.measurementChecklist)
      ? safe.measurementChecklist.slice(0, 10)
      : [],
    rfqNotes: Array.isArray(safe.rfqNotes) ? safe.rfqNotes.slice(0, 8) : [],
    followUpQuestions: Array.isArray(safe.followUpQuestions)
      ? safe.followUpQuestions.slice(0, 6)
      : [],
  };
};

const hasUseCaseSignal = (question, context, conversation = []) => {
  const conversationText = Array.isArray(conversation)
    ? conversation
        .filter((msg) => String(msg?.role || '').toLowerCase() === 'user')
        .map((msg) => String(msg?.content || ''))
        .join(' ')
    : '';

  const merged = [
    String(question || ''),
    String(context?.requirements?.description || ''),
    conversationText,
  ]
    .join(' ')
    .toLowerCase();

  const hasForClause = /\b(for|used for|used in|application|project|purpose|deploy|install)\b/.test(merged);
  const hasEnvironment =
    /\b(indoor|outdoor|coastal|marine|corrosion|humidity|temperature|load|pressure|food|pharma|medical|automotive|construction|electrical|water|oil|gas|hvac|pipeline)\b/.test(
      merged
    );
  const hasTechnicalNumbers =
    /\b\d+(\.\d+)?\s?(mm|cm|m|inch|in|kg|g|ton|tons|psi|bar|mpa|v|volt|a|amp|w|watt)\b/.test(merged);
  const hasRequirementBlock = String(context?.requirements?.description || '').trim().length >= 24;

  return hasForClause || hasEnvironment || hasTechnicalNumbers || hasRequirementBlock;
};

const buildUseCaseFirstResponse = (question, context) => {
  const productLabel = context?.productName || context?.title || 'this product';
  return {
    needsUseCase: true,
    assistantReply: `Before I recommend products and specs, I need your use case for ${productLabel}. Share project context so recommendations are accurate.`,
    suggestedProducts: [],
    recommendedSpecs: [],
    alternativeProducts: [],
    buyingChecklist: [],
    quantityEstimate: {
      estimatedRange: '',
      calculationMethod: '',
      assumptions: [],
      notes: '',
    },
    measurementChecklist: [],
    rfqNotes: [],
    followUpQuestions: [
      `What project are you using ${productLabel} for?`,
      'What environment will it face (indoor, outdoor, corrosive, high heat)?',
      'Any load/performance target or dimensions?',
      'Any quantity or budget range?',
    ],
  };
};

const fallbackProductClarification = (question, context) => {
  if (!hasUseCaseSignal(question, context, [])) {
    return buildUseCaseFirstResponse(question, context);
  }

  const productLabel = context?.productName || context?.title || 'your product';
  const categoryHint = context?.category ? ` in ${context.category}` : '';

  return {
    needsUseCase: false,
    assistantReply: `Based on your use case for ${productLabel}${categoryHint}, shortlist one standard-grade option, one performance-grade option, and one cost-focused option. Compare lifecycle cost and reliability before finalizing the RFQ.`,
    suggestedProducts: [
      {
        name: 'Standard-grade option',
        bestFor: 'Balanced cost and reliability in normal environments',
        keySpecs: 'Standard material grade and common dimensions',
      },
      {
        name: 'Performance-grade option',
        bestFor: 'Harsh environment or high reliability requirement',
        keySpecs: 'Higher grade material and tighter tolerance',
      },
      {
        name: 'Economy option',
        bestFor: 'Cost-sensitive projects with moderate duty',
        keySpecs: 'Entry-level grade with baseline compliance',
      },
    ],
    recommendedSpecs: [
      {
        name: 'Material/Grade',
        value: 'Specify exact grade and acceptable equivalent',
        whyItMatters: 'Prevents low-grade substitutions',
      },
      {
        name: 'Dimensions',
        value: 'Define key dimensions and tolerance',
        whyItMatters: 'Ensures fit and compatibility',
      },
      {
        name: 'Finish/Coating',
        value: 'Define surface treatment for operating environment',
        whyItMatters: 'Affects durability and lifecycle cost',
      },
    ],
    alternativeProducts: [
      {
        name: 'Higher-grade variant',
        useWhen: 'Reliability and lifecycle are critical',
        tradeOff: 'Higher upfront cost',
      },
      {
        name: 'Economy variant',
        useWhen: 'Budget-first with acceptable risk',
        tradeOff: 'Lower durability/service life',
      },
    ],
    buyingChecklist: [
      'Verify standard compliance and test certificate',
      'Confirm corrosion or temperature suitability',
      'Validate dimensions and tolerance compatibility',
      'Compare delivered lifecycle cost, not just unit price',
    ],
    quantityEstimate: {
      estimatedRange: 'Start with a pilot lot, then scale to 1.1x to 1.2x of base requirement.',
      calculationMethod: 'Required units = assemblies x units per assembly, then add 10% to 20% contingency.',
      assumptions: [
        'Assembly count is stable',
        'Wastage/rejection stays within expected range',
        'Safety stock needed for lead-time risk',
      ],
      notes: 'Refine quantity after pilot consumption data.',
    },
    measurementChecklist: [
      'Target dimensions and tolerance',
      'Operating temperature/exposure',
      'Expected load/performance',
      'Required certifications/standards',
    ],
    rfqNotes: [
      `Project use-case for ${productLabel}`,
      'Compliance/standard references',
      'Accepted substitutes',
      'Delivery location and required-by date',
    ],
    followUpQuestions: [
      `Where will ${productLabel} be used?`,
      'What tolerance or quality level is required?',
      'Do you prefer performance-first or cost-first options?',
    ],
  };
};

const buildNormalizedContext = (context = {}) => ({
  title: context?.basicInfo?.title || context?.title || '',
  category: context?.basicInfo?.category || context?.category || '',
  productName: context?.basicInfo?.productName || context?.productName || '',
  quantity: context?.basicInfo?.quantity || context?.quantity || '',
  quantityUnit: context?.basicInfo?.quantityUnit || context?.quantityUnit || '',
  deliveryLocation: context?.basicInfo?.deliveryLocation || context?.deliveryLocation || '',
  requiredBy: context?.basicInfo?.requiredBy || context?.requiredBy || '',
  existingSpecifications: context?.specifications || {},
  requirements: context?.requirements || {},
  calculatorEstimate: context?.calculatorEstimate || {},
});

export async function productClarificationAssistant(question, context = {}, conversation = []) {
  const cleanQuestion = String(question || '').trim();
  if (!cleanQuestion) {
    throw new Error('Question is required');
  }

  const normalizedContext = buildNormalizedContext(context);
  const needsUseCase = !hasUseCaseSignal(cleanQuestion, normalizedContext, conversation);

  if (needsUseCase) {
    return {
      ...buildUseCaseFirstResponse(cleanQuestion, normalizedContext),
      usedFallback: false,
      generatedAt: new Date().toISOString(),
    };
  }

  try {
    const { apiKey, model, apiUrl } = getGroqConfig();

    if (!apiKey) {
      return {
        ...fallbackProductClarification(cleanQuestion, normalizedContext),
        usedFallback: true,
        warning: 'Groq API key not configured',
        generatedAt: new Date().toISOString(),
      };
    }

    const systemPrompt = `You are a procurement and product advisory assistant for B2B buyers.

Provide practical, procurement-focused guidance for a buyer who is unsure about a product.

MANDATORY response order:
1) suggest suitable product options
2) suggest alternative product options
3) explain what to check while buying
4) provide approximate quantity/measurement guidance with assumptions and a simple method

Rules:
- Be specific but concise.
- If information is missing, mention what to clarify.
- Do not fabricate exact brand claims.
- If calculatorEstimate exists in context, use it.
- Clearly state assumptions for estimates.

Return ONLY valid JSON with this exact shape:
{
  "needsUseCase": false,
  "assistantReply": "string (2-6 short paragraphs)",
  "suggestedProducts": [
    { "name": "string", "bestFor": "string", "keySpecs": "string" }
  ],
  "recommendedSpecs": [
    { "name": "string", "value": "string", "whyItMatters": "string" }
  ],
  "alternativeProducts": [
    { "name": "string", "useWhen": "string", "tradeOff": "string" }
  ],
  "buyingChecklist": ["string"],
  "quantityEstimate": {
    "estimatedRange": "string",
    "calculationMethod": "string",
    "assumptions": ["string"],
    "notes": "string"
  },
  "measurementChecklist": ["string"],
  "rfqNotes": ["string"],
  "followUpQuestions": ["string"]
}`;

    const userPrompt = `Buyer question:\n${cleanQuestion}\n\nCurrent RFQ context (may be partial):\n${JSON.stringify(
      normalizedContext,
      null,
      2
    )}\n\nRecent conversation history:\n${JSON.stringify(
      Array.isArray(conversation) ? conversation.slice(-10) : [],
      null,
      2
    )}\n\nReturn JSON only.`;

    const response = await axios.post(
      apiUrl,
      {
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.35,
        max_tokens: 1400,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const content = response?.data?.choices?.[0]?.message?.content || '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : content);

    return {
      ...normalizePayload(parsed),
      usedFallback: false,
      generatedAt: new Date().toISOString(),
    };
  } catch (error) {
    const providerMessage =
      error?.response?.data?.error?.message ||
      error?.response?.data?.message ||
      error.message ||
      'AI provider unavailable';

    return {
      ...fallbackProductClarification(cleanQuestion, normalizedContext),
      usedFallback: true,
      warning: providerMessage,
      generatedAt: new Date().toISOString(),
    };
  }
}
