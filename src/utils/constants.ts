export const BASE_URL  = process.env.BASE_URL  ?? 'https://staging-hub.ezra.com';

export const CREDENTIALS = {
  email:    process.env.EZRA_EMAIL    ?? 'michael.krakovsky+test_interview@functionhealth.com',
  password: process.env.EZRA_PASSWORD ?? '12121212Aa',
};

export const STRIPE_CARDS = {
  validVisa:         { number: '4242424242424242', expiry: '12/34', cvc: '123' },
  insufficientFunds: { number: '4000000000009995', expiry: '12/34', cvc: '123' },
  declinedCard:      { number: '4000000000000002', expiry: '12/34', cvc: '123' },
  expiredCard:       { number: '4000000000000069', expiry: '12/34', cvc: '123' },
  incorrectCvc:      { number: '4000000000000127', expiry: '12/34', cvc: '123' },
};

export const SCAN_TYPES = {
  mriScan:     { name: 'MRI Scan',                                          price: '$999'  },
  mriSpine:    { name: 'MRI Scan with Spine',                               price: '$1699' },
  mriSkeletal: { name: 'MRI Scan with Skeletal and Neurological Assessment', price: '$3999' },
  heartCT:     { name: 'Heart CT Scan',                                     price: '$349'  },
  lungsCT:     { name: 'Lungs CT Scan',                                     price: '$399'  },
};

export const API_BASE = process.env.API_BASE ?? 'https://stage-api.ezra.com';

export const TEST_MEMBERS = {
  memberA: process.env.MEMBER_A_GUID ?? '83fd7da8-230a-48f8-b258-9dc95e4df785',
  memberB: process.env.MEMBER_B_GUID ?? 'f7b6e8ec-785b-4f7f-840f-c42cdcc45188',
};
