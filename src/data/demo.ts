import type { ProviderListing } from '../types';

export const categories = [
  { name: 'All', icon: 'sparkles' },
  { name: 'Electrician', icon: 'zap' },
  { name: 'Plumber', icon: 'wrench' },
  { name: 'Carpenter', icon: 'hammer' },
  { name: 'Painter', icon: 'paintbrush' },
  { name: 'AC repair', icon: 'snowflake' },
] as const;

export const demoProviders: ProviderListing[] = [
  {
    id: 'demo-1',
    profileId: 'demo-profile-1',
    name: 'Usman Ali',
    category: 'Electrician',
    bio: 'Reliable home and commercial electrical repairs. Available for urgent jobs.',
    experience: 8,
    rating: 4.9,
    reviews: 124,
    distance: '1.2 km',
    active: true,
    availabilityStatus: 'active',
    avatar: 'UA',
    services: [
      { name: 'Wiring repair', price: 500, negotiable: true },
      { name: 'Fan installation', price: 800 },
      { name: 'Switch replacement', price: 300 },
    ],
  },
  {
    id: 'demo-2',
    profileId: 'demo-profile-2',
    name: 'Bilal Ahmed',
    category: 'Plumber',
    bio: 'Pipe fitting, leak repair and bathroom installation around Gulberg.',
    experience: 6,
    rating: 4.8,
    reviews: 86,
    distance: '2.4 km',
    active: true,
    availabilityStatus: 'busy',
    avatar: 'BA',
    services: [
      { name: 'Leak repair', price: 600 },
      { name: 'Tap installation', price: 450, negotiable: true },
    ],
  },
  {
    id: 'demo-3',
    profileId: 'demo-profile-3',
    name: 'Hassan Woodworks',
    category: 'Carpenter',
    bio: 'Custom furniture and careful wood repairs. Free estimates available.',
    experience: 12,
    rating: 4.7,
    reviews: 59,
    distance: '3.1 km',
    active: false,
    availabilityStatus: 'inactive',
    avatar: 'HW',
    services: [
      { name: 'Door repair', price: 1000, negotiable: true },
      { name: 'Shelf installation', price: 1200 },
    ],
  },
];

export const demoBusinesses = [
  { name: 'City Electric & Hardware', category: 'Electrical', rating: '4.8', distance: '1.8 km' },
  { name: 'Gulberg Home Services', category: 'Repairs & maintenance', rating: '4.6', distance: '2.7 km' },
];
