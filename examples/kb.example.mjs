// Example knowledge base. Copy this file for a new client and replace every value.
export default {
  business: {
    name: 'Example Plumbing Co.',
    shortName: 'Example Plumbing',
    location: 'a plumber in Springfield',
    phone: '555-010-0199',
    phoneHref: 'tel:+15550100199',
    bookingUrl: '/book/',
  },
  widget: {
    title: 'Example Plumbing',
    subtitle: 'AI assistant · answers from our own info',
    placeholder: 'Ask about services, area, pricing…',
    footnote: 'For emergencies, call 555-010-0199.',
  },
  greeting: 'Hi! Ask me about our services, service area, pricing or payment.',
  refusal: 'Sorry, I can only help with questions about Example Plumbing. For anything else about a job, call [555-010-0199](tel:+15550100199).',
  thanksText: 'You’re welcome! Anything else?',
  errorText: 'Sorry, I’m having trouble right now. Please call [555-010-0199](tel:+15550100199).',
  starters: ['What services do you offer?', 'Do you serve my area?', 'How can I pay?'],
  // Buttons the assistant can offer under an answer. Reference them by key in qa[].options or defaultOptions.
  actions: {
    call: { label: 'Call now', href: 'tel:+15550100199', icon: 'phone', primary: true },
    book: { label: 'Book online', href: '/book/', icon: 'calendar' },
  },
  defaultOptions: ['call', 'book'],
  facts: ['Example Plumbing Co., 1 Main St., Springfield. Phone 555-010-0199.'],
  synonyms: { clog: ['drain'], toilet: ['drain', 'clog'], cost: ['price'], pay: ['payment'] },
  qa: [
    { q: 'What services do you offer?', tags: ['services'], a: 'Drain cleaning, water heaters and leak repair.' },
    { q: 'Do you serve my area?', tags: ['service area', 'neighborhood'], a: 'We serve Springfield and nearby towns.' },
    { q: 'How can I pay?', tags: ['payment', 'credit card'], a: 'Cash, checks and major cards.', options: ['How much does drain cleaning cost?', 'book'] },
    { q: 'How much does drain cleaning cost?', tags: ['price', 'drain'], a: 'Prices depend on the job; we quote before starting.' },
    { q: 'Do you clear clogged drains?', tags: ['drain', 'clog', 'sewer'], a: 'Yes, kitchen, bathroom and main lines.' },
  ],
};
