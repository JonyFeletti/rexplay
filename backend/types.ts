export interface SubscriptionRow {
  id: number;
  user_id: string;
  plan_id: string;
  status: "incomplete" | "pending" | "active" | "past_due" | "canceled";
  processor_subscription_id: string | null;
  external_reference: string | null;
  card_brand: string | null;
  card_last4: string | null;
  current_period_end: string | null;
  next_billing_at: string | null;
  grace_ends_at: string | null;
  failed_attempts: number;
  cancel_at_period_end: boolean;
  canceled_reason: string | null;
  first_payment_at: string | null;
  created_at: string;
  canceled_at: string | null;
}

export interface UserBasic {
  id: string;
  email: string;
  name: string;
}

export interface ProfileRow {
  id: number;
  user_id: string;
  name: string;
  avatar: string;
  created_at: string;
}

export interface ProfileView {
  id: number;
  name: string;
  avatar: string;
}

export interface CardInput {
  token: string;
  payment_method_id?: string;
}