export type UserRole = 'provider' | 'taker' | 'business_owner' | 'admin';
export type ProviderAvailability = 'active' | 'busy' | 'inactive';
export type ProviderVerificationStatus = 'pending' | 'verified' | 'rejected';

export type Profile = {
  id: string;
  role: UserRole | null;
  name: string | null;
  avatar_url?: string | null;
  phone?: string | null;
  providerVerificationStatus?: ProviderVerificationStatus | null;
  providerProfile?: {
    id: string;
    isActive: boolean;
    availabilityStatus: ProviderAvailability;
    verificationStatus: ProviderVerificationStatus;
    category: string;
    latitude: number | null;
    longitude: number | null;
  } | null;
  isOfflineCached?: boolean;
};

export type ProviderStatusSyncState = 'idle' | 'pending' | 'syncing' | 'synced' | 'error';

export type ProviderListing = {
  id: string;
  profileId: string;
  name: string;
  category: string;
  bio: string;
  experience: number;
  rating: number;
  reviews: number;
  distance: string;
  active: boolean;
  availabilityStatus?: ProviderAvailability;
  isOnline?: boolean;
  lastSeenAt?: string | null;
  locationUpdatedAt?: string | null;
  isVerified?: boolean;
  avatar: string;
  avatarUrl?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  services: { name: string; price: number; startingFrom?: boolean; negotiable?: boolean }[];
};
